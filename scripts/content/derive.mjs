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
// `zone_derived` rows renderers read INSTEAD of computing anything themselves.
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
 *
 * NOTHING HERE READS PRESENTATION. A green-dominant `bg_color` used to resolve to
 * `grass` — a bridge built when tiles had colours but no terrain painter, and
 * harmless only for as long as nobody turned `bg_color`. `bg_color` is now the
 * per-tile map override (§ tile-presentation-overrides), a knob the Studio invites
 * you to turn, so that rung became a way to reclassify a room by tinting it — and
 * `flags.terrain` is the SSOT `resolveProps` reads. Cosmetics read from terrain;
 * they must never write back to it. The 42 tiles that resolved that way say it in
 * the flag now (scripts/content/tile-override-cleanup.mjs) and the rung is gone.
 * The rungs below survive because they read FLAGS, not presentation.
 */
export function resolveTerrain(zone) {
  const f = zone?.flags || {};
  if (f.terrain) return f.terrain;
  // DEPRECATED fallbacks, kept verbatim so hand-authored legacy content still
  // reads right. (`flags.water` was the last rung here; it was migrated away
  // 2026-07-21, and because it sat on no row every `flags.water` test in the
  // engine had silently become a no-op — GPS and pathfinding were routing across
  // the basin. Removed with its readers 2026-07-30; water is `terrain: 'water'`,
  // full stop, and there is no second way to say it.)
  if (f.pier) return 'dock';
  if (/^(road_|runway_)/.test(f.icon || '')) return 'road';
  // A building footprint is not ground. (buildingIconSvg's condition: the facade
  // tag present at all, plus a building_type to pick an icon by.)
  if (Object.prototype.hasOwnProperty.call(f, 'facade') && String(f.building_type || '')) return null;
  return null;
}

/**
 * GAMEPLAY PROPERTIES — the terrain-preset / tile-override resolution.
 * docs/proposals/terrain-property-presets.md
 *
 * A terrain type presets a set of properties; a tile overrides any one of them
 * with a flag of the same name. Gameplay then asks for the CAPABILITY it means
 * (`propsOf(id).swimmable`) instead of asking what the tile is painted — so a
 * frozen bay is `terrain:'water'` + `swimmable:false, routable:true`, still blue
 * on the map and walked across, without inventing a terrain type.
 *
 * Defaults describe ordinary solid ground, so an unpainted tile and a terrain
 * with no `props` block both land somewhere sane.
 */
// The TYPE of each default is also its contract: a boolean property coerces to a
// boolean, a numeric one to a finite number. Adding a key here is what makes it
// resolvable, lintable and overridable — there is no second list.
export const PROP_DEFAULTS = Object.freeze({
  liquid: false,      // you are IN this tile, not ON it
  swimmable: false,   // entering costs stamina; wetness, drowning, hypothermia
  underwater: false,  // submerged BELOW a surface tile: breath timer, colder, dark
  routable: true,     // GPS and pathfinding may cross it
  buildable: true,    // the dev-panel builder may place/move a building here
  frontage: false,    // a street a building's front door can face onto
  speed_mult: 1,      // movement pacing multiplier (road = 2)
});

/**
 * tile flag  →  terrain preset  →  global default.
 *
 * `key in flags`, NOT `flags[key]` — and that distinction is the whole reason the
 * override rung is a flag rather than a nullable column. resolveDefault below
 * documents the hole it cannot close: "absent and none are the same bytes". For a
 * boolean that is fatal — you could never mark one water tile non-swimmable. JSON
 * tells absent from `false`, so `{ "swimmable": false }` is an explicit no and a
 * missing key is "no opinion, inherit".
 *
 * No region rung. "This district sounds like neon rain" is a real authorial
 * statement; "this district is swimmable" is not. If one is ever wanted it slots
 * in between the two rungs below, unchanged.
 */
export function resolveProps(zone, palette) {
  const flags = zone?.flags || {};
  const terrain = resolveTerrain(zone);
  const preset = (terrain && palette?.terrains?.[terrain]?.props) || {};
  const out = { ...PROP_DEFAULTS, ...preset };
  for (const key of Object.keys(PROP_DEFAULTS)) {
    if (!(key in flags)) continue;
    out[key] = coerceProp(key, flags[key]);
  }
  return out;
}

// Coerce an override to the type its default declares. A numeric property must not
// silently become `true` (the boolean path's `!!` would have done exactly that to
// `speed_mult: 2`), and a garbage value falls back to the resolved default rather
// than poisoning a movement multiplier with NaN. content:lint rejects both cases at
// author time; this is the runtime floor under it.
function coerceProp(key, value) {
  if (typeof PROP_DEFAULTS[key] === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : PROP_DEFAULTS[key];
  }
  return !!value;
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
 * The tile's map colours. AUTHORED BEATS DERIVED, with no exception list.
 *
 * This used to ask the palette FIRST and reach the tile only through an
 * `authored_bg_wins` flag that was true on three terrains, so 3,484 authored
 * fills and 150 authored glyph colours were read and thrown away. That guardrail
 * was not defending a second meaning — nothing renders `zones.bg_color`, every
 * consumer colours from `spec.fill` — it was defending against the pre-terrain
 * bulk fill sitting in the same column (2,923 redrock tiles carrying a room
 * brown). tile-override-cleanup.mjs cleared that fill, on the argument that a
 * value derive has always discarded cannot be authorship: nobody has ever seen
 * one work. With the column holding only deliberate overrides, the guardrail has
 * nothing left to guard and the field means what the Studio always said it did.
 *
 * Falling all the way through to contrast means `text` is FINAL — a renderer
 * never has to decide anything, which is the whole point of §2.3.
 */
export function deriveColors(zone, palette) {
  const entry = paletteEntry(zone, palette);
  const bg = zone?.bg_color ?? entry?.fill ?? null;
  const color = zone?.color ?? entry?.text ?? contrastText(bg);
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

// ── deriveAutoTile — adjacency-aware art (§7.3) ──────────────────────────────
//
// Which connector piece a road draws is a function of its NEIGHBOURS, so like the
// building markers this can only be right if something sees the whole map at once.
// `ctx.byCell` is the coordinate index deriveWorld builds in the same pass.
//
// This is the second copy of one rule and the last: world.js `roadConnector` computes
// it live per map payload off the same adjacency (a third, the zone-planner's
// export-time `roadIcon` bake, died with that tool). Here it lands in the spec, so a
// renderer draws the network instead of re-deriving it.
//
// TWO TILES JOIN WHEN BOTH TERRAINS AUTO-TILE. Today that set is exactly
// {road, dirt_road}, which reproduces world.js's `isRoadTerrain` deliberately: a
// graded dirt lane meets a paved street at a proper junction and draws the same
// piece, recoloured by the palette's own `text`. A future auto-tiling terrain that
// must NOT fuse with roads would need a family key in the palette — inventing that
// field before a second family exists is how the three drifted terrain tables in
// content/map/terrain.json's header happened.
const AUTO_DIRS = Object.freeze({ n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] });
// One key format for "which tile is at this coordinate", used by both whole-map
// passes (this one and projectEdges) and by the Studio's neighbour lookup.
export const gridKey = (mapId, x, y, z) => `${mapId ?? ''}|${x},${y},${z ?? 0}`;

/**
 * ONE COORDINATE INDEX, built once and read by both whole-map passes.
 *
 * There used to be two, and they disagreed in both directions available:
 * deriveWorld's was last-wins (one tile per cell) and INCLUDED off-map rooms, while
 * projectEdges' was a list and SKIPPED them. Neither difference showed on this
 * world's map today — measured: 0 auto-tile lookups resolve differently — but both
 * are real:
 *
 *   • 6 cells hold more than one tile, and a last-wins map hands the auto-tiler
 *     whichever one sorts last. A road beside a cell holding road + not-road could
 *     draw an arm to nothing, or fail to draw one it should.
 *   • 7 off-map rooms — the Echelon suite's bath and boudoir, four Solenne baths,
 *     The Inbetween — all carry coordinates and no map, so they collided on the
 *     single key `|0,0,0` and shadowed each other. An off-map room has no map to be
 *     adjacent ON, so it does not belong in a geometry index at all.
 *
 * Cells are LISTS and off-map rooms are skipped, which is projectEdges' rule — it
 * was the correct one. `anyAuto` is then the honest reading of a shared cell: if
 * anything standing there auto-tiles, the lane joins it.
 */
export function buildCellIndex(zones) {
  const byCell = new Map();
  for (const z of zones) {
    if (z?.map_id == null || z?.grid_x == null || z?.grid_y == null) continue;
    const k = gridKey(z.map_id, z.grid_x, z.grid_y, z.grid_z);
    if (!byCell.has(k)) byCell.set(k, []);
    byCell.get(k).push(z);
  }
  return byCell;
}

export function deriveAutoTile(zone, palette, ctx = {}) {
  const out = { n: false, e: false, s: false, w: false };
  // A tile with no coordinates has no neighbours to speak of — 530 interiors and
  // every off-map room. All-false is the honest answer, and it is what an isolated
  // road tile draws anyway (the `road_x` dot).
  if (!ctx.byCell || zone?.grid_x == null || zone?.grid_y == null) return out;
  const gz = zone.grid_z ?? 0;
  for (const [dir, [dx, dy]] of Object.entries(AUTO_DIRS)) {
    const at = ctx.byCell.get(gridKey(zone.map_id, zone.grid_x + dx, zone.grid_y + dy, gz)) || [];
    out[dir] = at.some(n => paletteEntry(n, palette)?.auto_tile);
  }
  return out;
}

// ── The tile stack — ground, feature, label (§7.7) ───────────────────────────
//
// A tile is at most three layers, and which layers it HAS is the whole answer to
// what a renderer may do to it:
//
//   ground   fill + terrain texture      always
//   feature  one named SVG footprint     optional — the thing standing on the ground
//   label    a human code someone reads  optional — only where a code means anything
//
// The map's overlay toggle acts on `label` and on a BUILDING's feature. It cannot
// reach a road, because a road tile has no `label` key — there is nothing there to
// toggle. That is the point of expressing the hierarchy as data rather than as an
// `isBuilding()` predicate each renderer re-derives: the client had one, the tablet
// had another, and they disagreed about interiors.
//
// Building type → top-down rooftop footprint SVG (client/game/assets/zone-icons/
// bldg_*.svg). Synonyms collapse (store/grocery → shop); an unrecognised-but-present
// type gets a plain office block. MOVED HERE FROM world.js so the build resolves a
// footprint the same way the engine always did — world.js now delegates, exactly as
// it does for `resolveTerrain`.
//
// STANDARD: a new building_type needs BOTH a 2-D footprint here AND a 3-D shape in
// BLDG_TYPE_3D (client/game/js/panels/windshield.js) so it reads consistently on the
// map and from the air. Each registry has its own fallback, so an unlisted type still
// renders something rather than nothing.
export const BUILDING_TYPE_ICON = Object.freeze({
  residential: 'bldg_residential', apartment: 'bldg_apartment',
  shop: 'bldg_shop', store: 'bldg_shop', grocery: 'bldg_shop',
  bar: 'bldg_bar', club: 'bldg_club', nightclub: 'bldg_club', boutique: 'bldg_shop', police: 'bldg_police',
  corporate_office: 'bldg_office', hotel: 'bldg_hotel', power: 'bldg_power',
  hangar: 'bldg_hangar', studio: 'bldg_studio', clinic: 'bldg_clinic', diner: 'bldg_diner',
  gun_shop: 'bldg_gunshop', casino: 'bldg_casino', fence: 'bldg_fence', chem_supply: 'bldg_chem',
  // The Yards — semi-industrial freight district (docs/proposals/yards.md).
  warehouse: 'bldg_warehouse', container_yard: 'bldg_container', fuel_yard: 'bldg_fuel', cold_storage: 'bldg_cold',
  fabrication: 'bldg_fab', wharf: 'bldg_wharf', freight_office: 'bldg_freightoffice', freight_forwarder: 'bldg_forwarder',
  // The Ascendant Stronghold (docs/proposals/ascendant-stronghold.md) — reuse the nearest existing
  // glyphs so the campus reads on the 2-D map this build; bespoke SVGs are an optional polish pass.
  asc_spire: 'bldg_office', asc_gate: 'bldg_police', asc_clinic: 'bldg_clinic',
  asc_weave: 'bldg_fab', asc_vats: 'bldg_cold', asc_shrine: 'bldg_power',
});

// Gated on the `facade` tag so interior tiles (which also carry is_building) never
// wear a rooftop. Zones keep their tags in `flags`, so this is engine `hasTag`
// spelled out — derive imports nothing, and that is enforced, not stylistic.
const hasFacadeTag = (zone) => Object.prototype.hasOwnProperty.call(zone?.flags || {}, 'facade');

export function buildingIconSvg(zone) {
  if (!zone || !hasFacadeTag(zone)) return null;
  const bt = String(zone?.flags?.building_type || '').toLowerCase();
  return BUILDING_TYPE_ICON[bt] || (bt ? 'bldg_office' : null);
}

// The connector piece an auto-tiled tile draws. Direction order is n,e,s,w and must
// stay that way — it is the filename (`road_nesw.svg`), not a set.
export const autoTileName = (at) => {
  const s = ['n', 'e', 's', 'w'].filter((d) => at?.[d]).join('');
  return s ? `road_${s}` : 'road_x';   // no neighbours ⇒ the lone dot
};

/**
 * The one SVG this tile draws, resolved at BUILD time. Precedence, highest first:
 *
 *   1. authored `flags.icon`   — the override. A statue, a helipad, an AA nest,
 *                                or a road piece someone pinned by hand.
 *   2. building rooftop        — a facade draws its type's footprint.
 *   3. auto-tiled connector    — a road draws the piece its neighbours imply.
 *   4. nothing.
 *
 * This used to be `tileIconSvg` in world.js, recomputed per map payload from a
 * whole-map coordinate index rebuilt on every send. Resolving it here is what lets
 * the Studio show the shipped value rather than an approximation of it, and it
 * retires the third and fourth copies of the road-adjacency rule (world.js
 * `roadConnector`, the dev panel's mirror of it).
 */
export function deriveFeature(zone, autoTile = null) {
  return featureProvenance(zone, autoTile).name;
}

/**
 * The same precedence, plus WHICH RUNG WON — for an editor that has to explain a tile
 * rather than just draw it. `deriveFeature` delegates to this so the order lives in one
 * place; a second copy written "just for the inspector" is how a tool starts disagreeing
 * with the build about what it is showing you.
 *
 * `implied` is what adjacency alone would draw, and `stale` is the point of the whole
 * function: an authored pin does not grow an arm when someone paints a lane beside it
 * later, so a pinned tile whose neighbours have moved on is a defect rather than a
 * decision — visible per tile instead of only in an aggregate count (§7.7).
 *
 * SAME-FAMILY ONLY. A runway resolves to `road` terrain (resolveTerrain reads the
 * `runway_` icon prefix) and therefore auto-tiles, but `runway_ns` is a deliberate
 * choice of a different piece set, not a stale road. Comparing across families marked
 * all 10 runway tiles as drift — in a regress count, and as a false warning on the
 * tile itself. This is the ONE definition of staleness; deriveWorld reports from it.
 *
 * @returns {{ source: 'authored'|'rooftop'|'auto'|null, name: string|null,
 *             implied: string|null, stale: boolean }}
 */
export function featureProvenance(zone, autoTile = null) {
  const implied = autoTile ? autoTileName(autoTile) : null;
  const authored = zone?.flags?.icon;
  if (authored) {
    const name = String(authored);
    const stale = !!implied && name.startsWith('road_') && implied !== name;
    return { source: 'authored', name, implied, stale };
  }
  const rooftop = buildingIconSvg(zone);
  if (rooftop) return { source: 'rooftop', name: rooftop, implied, stale: false };
  if (autoTile) return { source: 'auto', name: implied, implied, stale: false };
  return { source: null, name: null, implied, stale: false };
}

/**
 * The code a human reads off this tile, or null. Three kinds, because the overlay
 * toggle treats them differently:
 *
 *   building  a navigable 2-letter code (Labels mode turns the tile into that box)
 *   room      an apartment designation / floor — a code, but not a landmark
 *   art       sewer-corridor connectivity art: the tile's own drawing, like a road
 *             connector, so it survives every overlay mode and is never toggled off
 *
 * PAINTED GROUND USED TO BE UNLABELLABLE, and that rule is gone. It read
 * `if (resolveTerrain(zone)) return null`, and it existed because 860 tiles authored
 * a terrain DECORATION in `zones.marker` (`#` on grass, `≈` on water, six textures on
 * road) which, drawn, letters the grasslands `# # # #`. Suppressing every marker on
 * every painted tile was the cheapest way to not draw them — at the cost of the
 * deliberate per-tile symbol, which is the thing the field is FOR.
 *
 * The decorations were deleted instead (tile-override-cleanup.mjs), so the rule has
 * nothing left to suppress and a marker now means what the Studio says it means.
 * Bare painted ground is still the shipped look: no terrain carries a palette
 * `glyph`, and that slot — not the tile — is where "grass looks stippled" belongs if
 * it ever comes back.
 *
 * A BUILDING CARRYING TERRAIN IS STILL A CONTENT BUG. Two tiles were in that state —
 * Hall of Records (a poured-concrete civic building flagged `terrain: road`) and
 * Halloran's Fix-It (a shopfront flagged `grass`) — and both had silently lost their
 * navigable codes, because `resolveTerrain` reads `flags.terrain` before it reads its
 * own "a building footprint is not ground" rung. Removing the rule here does not make
 * that combination legal: it is removed from the two files, `content:lint` errors on
 * it, and the Studio refuses to paint ground onto a building. What the old rule did
 * incidentally — keep a labelled road from being a road the overlay toggle can stamp
 * letters on — is now held by those three, plus the fact that no road tile authors a
 * marker any more.
 */
export function deriveLabel(zone, palette, ctx = {}) {
  const text = deriveMarker(zone, palette, ctx);
  if (!text) return null;
  const kind = isBuildingTile(zone) ? 'building' : (isSewerTile(zone) ? 'art' : 'room');
  return { text, kind };
}

// ── projectEdges — the traversal graph (§7.5) ────────────────────────────────
//
// Geometry says where tiles TOUCH. It does not say where a player can WALK, and
// this world is emphatic about the difference: 21,203 authored exits against
// 21,478 cardinal adjacencies. The gap is not noise — it is 660 directed walls,
// and the whole design of this function is the search for which of them are a
// RULE and which are a DECISION.
//
// Measured over the shipped world, ONE rule and 404 files reproduce every one of
// the 21,203 edges exactly:
//
//   grid            21,478 raw cardinal adjacencies on the same map
//   − facade rule      280  a facade opens at flags.entrance and nowhere else
//   = 21,198 projected, of which 380 are wrong and 385 are missing
//   + 404 connection files (214 links geometry cannot say, 190 walls it cannot
//     un-say) → exact agreement with zones.exits
//
// The wilds curtain was the second rule and is now 133 of those walls — see the
// note above crossesCurtain's grave, below. It left because its input was a field
// an editor paints, not because a rule is worse than a file.
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
const cellKey = (z) => gridKey(z.map_id, z.grid_x, z.grid_y, z.grid_z);

/**
 * A facade is a building's street face. It is a wall on three sides and a door on
 * one, and WHICH one is authored (`flags.entrance`) precisely so terrain paint
 * cannot relocate it — the lesson of 2b6d0680. Without this the 62 facades open
 * on every side they touch: 280 doors nobody cut.
 */
const facadeBlocks = (z, dir) => !!z?.flags?.facade && z.flags.entrance !== dir;

// THE CITY↔WILDS CURTAIN USED TO BE A RULE HERE, and is now 133 authored walls
// (`scripts/content/mint-curtain-walls.mjs`, which states the whole argument).
// The short version: the rule read `flags.district === 'wilds'`, and `district` is
// a presentation field the Studio paints. Erasing a district on a frontier tile
// deleted a wall with no diff to show for it, and a player would have walked into
// the killing ground without passing The South Gate. A wall is a fact about a
// place, so it is content; this module no longer knows what a district is.
//
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
  // this is a list and every occupant is a candidate neighbour. Shared with the
  // render pass — see buildCellIndex for why there is only one of these now.
  const byCell = buildCellIndex(sorted);

  const grid = new Map();   // `from|dir|to` → row
  for (const z of sorted) {
    if (!byCell.has(cellKey(z))) continue;
    for (const [dir, [dx, dy]] of Object.entries(CARDINAL)) {
      if (facadeBlocks(z, dir)) continue;
      const neighbours = byCell.get(`${z.map_id}|${z.grid_x + dx},${z.grid_y + dy},${z.grid_z ?? 0}`) || [];
      for (const n of neighbours) {
        if (facadeBlocks(n, OPPOSITE[dir])) continue;
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
      let walled = false;
      for (const k of [`${c.a}|${c.dir}|${c.b}`, `${c.b}|${OPPOSITE[c.dir]}|${c.a}`]) {
        if (!grid.has(k)) continue;
        blocked.add(k);
        walled = true;
      }
      // A wall that walls nothing is a file whose reason has been edited away —
      // the tiles moved apart, or a rule now covers it. Reported, not silent.
      //
      // "Nothing" means NEITHER DIRECTION. This tested only the forward key, so a
      // wall whose one existing grid edge ran the other way did real work and was
      // reported redundant anyway — and the fix for a redundant wall is deleting it,
      // which here would have re-opened the step. Nothing on this world is in that
      // state (0 reported before and after), so this closes it before it bites.
      if (!walled) unusedBlocks.push(c.id);
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
export function buildRenderSpec(zone, palette, resolved, ctx = {}) {
  const entry = paletteEntry(zone, palette);
  const spec = {
    fill: resolved.bg_color,
    text: resolved.color,
    minimap_class: entry?.minimap_class ?? null,
    terrain: resolveTerrain(zone),
    // `speed_mult` used to sit here. It is gameplay, not presentation, so it moved to
    // the props payload on 2026-07-30 — where a tile can also override it. Nothing
    // renders from it; pacing reads props.speed_mult.
  };
  // `glyph: resolved.marker` used to sit here. It had exactly one consumer in the
  // repo — the Studio's inspector debug line — because the map reads the AUTHORED
  // `zones.marker` off the payload instead. So the derived marker (62 building
  // acronyms, 116 apartment designations, 118 sewer corridors) shipped in the spec
  // and was ignored, while the authored value it was meant to replace did the work.
  // `spec.label` below is that same value with the missing half of the wiring.
  //
  // §2.3: present iff the palette auto-tiles this terrain, and then it carries the
  // adjacency itself rather than a boolean the renderer would have to chase. It was
  // a bare `!!entry.auto_tile` — true on 158 tiles, false on 5,700 — which told a
  // renderer that a tile auto-tiles without telling it what to draw, so nothing drew
  // anything and the Studio fell back to lettering the road with `#`.
  const autoTile = entry?.auto_tile ? deriveAutoTile(zone, palette, ctx) : null;
  if (autoTile) spec.auto_tile = autoTile;
  // The two layers that stand on the ground. Both present-iff, so a renderer tests
  // for the layer instead of testing a null against five thousand tiles.
  const feature = deriveFeature(zone, autoTile);
  if (feature) spec.feature = feature;
  const label = deriveLabel(zone, palette, ctx);
  if (label) spec.label = label;
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

  // Sorted ONCE, and everything below walks this list. Both whole-map passes have
  // to agree on order or they are not deterministic (§7.2) — and while the cell
  // index no longer picks a winner per cell (buildCellIndex keeps every occupant),
  // the marker pass and the order of `render` still ride on this.
  const sorted = [...zones].sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
  const ctx = { buildingMarkers, byCell: buildCellIndex(sorted) };
  const featureOverrides = [];

  for (const zone of sorted) {
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
    const spec = buildRenderSpec(zone, palette, resolved, ctx);
    // An authored `flags.icon` outranks auto-tiling, which is what makes it an
    // override — but a road piece frozen by hand does not grow an arm when someone
    // paints a lane beside it later. Report the disagreements rather than resolving
    // them: which of the two is right is a human call about the map, and silently
    // preferring either would be this pass deciding content.
    // Reported from featureProvenance's `stale`, not re-derived here — the Studio warns
    // on the same tiles this list names, because it is the same function deciding.
    const prov = featureProvenance(zone, spec.auto_tile ?? null);
    if (prov.stale) featureOverrides.push({ id: zone.id, authored: prov.name, implied: prov.implied });
    // ONE CHANNEL PER VALUE. `glyph` was `resolved.marker` under a second name,
    // top-level `color`/`bg_color` were `spec.text`/`spec.fill`, and top-level
    // `minimap_class` was `spec.minimap_class` — four columns carrying a value
    // something else in the same row already carried, and not one of them had a
    // reader (every consumer resolves through `spec`, and `marker` survives because
    // regress holds it to the authored value). Two channels for one value is the
    // drift this whole pass was built to delete; keeping the unread half is how the
    // next reader concludes there are two ways to letter a tile.
    // Spelled out rather than spread, so the row's columns and derive-write's
    // RENDER_COLS read as the same short list. `color`/`bg_color` stay in `resolved`
    // because buildRenderSpec turns them into spec.text/spec.fill — they just do not
    // get a second home on the row.
    render.set(zone.id, {
      zone_id: zone.id,
      marker: resolved.marker,
      icon: resolved.icon,
      ambient_theme: resolved.ambient_theme,
      audio_theme_id: resolved.audio_theme_id,
      spec,
      props: resolveProps(zone, palette),
    });
  }

  // The traversal graph. Built and written, but NOT yet read: `zones.exits` is
  // still the source of truth the engine boots from, and the two are held to
  // exact agreement by regress (§11 step 6). Deleting `exits` is §5 and its own
  // step — this one only earns the right to.
  const { edges, undeclaredOneWays, unusedBlocks } = projectEdges(zones, connections);

  return { render, edges, index: null, markerCollisions: collisions, featureOverrides, undeclaredOneWays, unusedBlocks };
}
