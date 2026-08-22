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
  passable: true,     // a body may enter this tile at all — cliff is the one no
  // A tile that is `passable: false` AND `climbable: true` is a rock face with a
  // WAY UP IT — broken enough for hands and rope. It is a second key rather than a
  // third value of `passable` because the two answer different questions and the
  // readers are different: `passable` is the law (may a body enter), `climbable` is
  // the exception's own precondition, and a reader that only knows about `passable`
  // must go on getting the safe answer. Bare `cliff` never carries it, so the
  // absolute wall stays absolute; see the scree terrain and the ⚠ on the
  // engine:impassable-terrain gate in commands/movement.js.
  climbable: false,   // …and this one has a route up it, for somebody equipped
  thermal: false,     // this water is geothermally heated (waterTemperature)
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
export function coerceProp(key, value) {
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
// `zones.marker` was doing four jobs at once. After the split it means one of
// two things, and which one is decided by the tile, not by the field:
//
//   building acronym       62 tiles → derived from building_name; authored wins
//   apartment designation  116      → derived from the unit name
//   sewer corridor art     118      → STAYS AUTHORED. See below.
//   terrain glyph          846      → STAYS AUTHORED. See below.
//
// The sewer row used to be derived from connectivity, and the derivation is
// gone. It was the only client of a `kind: 'art'` label class whose whole job
// was exempting it from the overlay toggle — a category with one member, keyed
// on an id prefix, which is how 34 room decorations ended up classified as
// corridor structure and undismissable on the map. The 115 corridor pieces are
// now ordinary authored markers, computed once and committed, and a marker is
// how you put art on ANY tile rather than a thing the sewers alone can have.
// The trade is real and deliberate: re-cutting a sewer exit no longer re-cuts
// its glyph. That is the same trade every other authored tile already makes.
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

// `sewerArt(exits)` used to live here — a ╬/╠/═ lookup keyed on which cardinals a
// tile exits to, so the sewers drew their own shape. It was the only reason
// `deriveLabel` had a third kind, and the shape it derived is now sitting in the
// 117 `zone_under_*` files as an ordinary authored marker (the 4 tiles with a way
// up carry ◍ instead, which no connectivity rule could have produced). Restoring
// it means restoring the id-prefix test with it — see the note on deriveMarker.

// A BUILDING for marker purposes is a tile on the overworld a player navigates BY
// — the thing whose code appears in Labels mode. `is_building` also sits on 90
// interior rooms (Echelon cabins, aircraft interiors, the Ascendant campus), and
// giving those an acronym would put a building code on a room nobody navigates to
// by code, which is precisely what MARK-1 exists to complain about.
const isBuildingTile = (z) => (z?.map_id === 'map_world') && !!(z?.flags?.facade || z?.flags?.is_building);
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

// ── The perimeter wall (the overlay layer) ───────────────────────────────────
//
// A WALL IS NOT A MASS, and that is the whole reason this cannot reuse the cliff
// family. `autoTileName` names the sides that JOIN and the cliff art inverts that
// into faces on the sides that DON'T — exactly right for high ground, because there
// the mass IS the connected set. The Curtain is a BOUNDARY: its connected set is the
// line itself, so "the sides missing from the run" is ambiguous on every straight
// tile (a lone e–w run is missing both n and s) and outright wrong on a zigzag,
// where two consecutive corners name opposite faces for the segment between them.
//
// So a wall tile carries its OUTWARD FACES rather than its joins, and to have them it
// has to know which side the city is on. That is a whole-map question — hence the
// component pass below — and it is answered GEOMETRICALLY. A `district === 'wilds'`
// test here would read the Basin's own content out of a file that is supposed to know
// nothing about it, and the next game's wall encloses something else.
//
// The gate counts as wall for both passes, exactly as it does in the flight sim
// (`isCurtain` in plugins/flight/state.js): the flanking wall has to butt into the
// pylons rather than stop a tile short of them and leave the line broken.
const isCurtainZone = (z) => !!(z?.flags?.curtain || z?.flags?.perimeter_gate);

/**
 * Every wall cell, plus the CENTROID OF ITS CONNECTED RUN — which is this pass's
 * whole answer to "which way is out".
 *
 * Per component, never globally: a second wall elsewhere on the map (an east gate,
 * another city) would drag a single shared centroid off both of them and face half
 * the tiles inward. Components are 4-connected, same as every other pass here.
 *
 * DEGENERATE CASE, named because it is the one the rule cannot answer: a wall that
 * encloses nothing — a single straight segment — has its centroid ON the line, so
 * both perpendicular sides are equally far out and there is no geometry left to ask.
 * That resolves to w/n by the `>` in deriveCurtain, deterministically and
 * arbitrarily. A real perimeter turns at least one corner, and that one bend is what
 * breaks the tie for every tile in the run, including the straight ones nowhere near it.
 */
export function buildCurtainIndex(zones) {
  const cells = new Map();
  for (const z of zones) {
    if (!isCurtainZone(z) || z?.map_id == null || z?.grid_x == null || z?.grid_y == null) continue;
    cells.set(gridKey(z.map_id, z.grid_x, z.grid_y, z.grid_z), { map: z.map_id, x: z.grid_x, y: z.grid_y, z: z.grid_z ?? 0 });
  }
  const centroid = new Map();
  const seen = new Set();
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    const comp = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const c = cells.get(queue.pop());
      comp.push(c);
      for (const [dx, dy] of Object.values(AUTO_DIRS)) {
        const nk = gridKey(c.map, c.x + dx, c.y + dy, c.z);
        if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); queue.push(nk); }
      }
    }
    const mid = {
      x: comp.reduce((a, c) => a + c.x, 0) / comp.length,
      y: comp.reduce((a, c) => a + c.y, 0) / comp.length,
    };
    for (const c of comp) centroid.set(gridKey(c.map, c.x, c.y, c.z), mid);
  }
  return { cells, centroid };
}

/**
 * The sides of this tile the wall presents to the OUTSIDE, as `n`/`e`/`s`/`w` in
 * that order — `'s'` a horizontal wall along the tile's south edge, `'sw'` the corner
 * L, `'w'` a vertical one up its west edge. Null on every tile that is not wall,
 * which is 5,800 of them.
 *
 * ONE FACE PER AXIS THE WALL RUNS ON. A tile joined north–south is a vertical run, so
 * it can only present an east or a west face; a corner joined north and east runs on
 * both axes and presents one of each, and the two strokes meet at the tile's own
 * corner because they are drawn on its own edges. That is what makes the line
 * continuous across tiles without any renderer knowing what its neighbours drew:
 * adjacent tiles in one run agree on the face, so their strokes are collinear and touch.
 *
 * PUTTING THE STROKE ON THE EDGE IS THE POINT, not a detail of the art. A wall drawn
 * through the middle of its tile says the tile is the wall, and a player who walks
 * onto it is standing inside a floor-to-sky sheet of hard light. On the edge, the
 * tile's body stays clear and reads as the ground behind the wall — which is what it
 * is, because the Curtain is an overlay and the tile keeps its real terrain.
 *
 * THE LETTERS MEAN THE OPPOSITE OF `autoTileName`'s, deliberately, which is why the
 * payload names them apart (`spec.curtain` vs `spec.feature`). They are faces, not
 * joins; nothing reads both keys, so no renderer ever has to guess which it holds.
 */
export function deriveCurtain(zone, ctx = {}) {
  if (!ctx.curtain || !isCurtainZone(zone) || zone?.grid_x == null || zone?.grid_y == null) return null;
  const gz = zone.grid_z ?? 0;
  const mid = ctx.curtain.centroid.get(gridKey(zone.map_id, zone.grid_x, zone.grid_y, gz));
  if (!mid) return null;
  const joined = (dx, dy) => ctx.curtain.cells.has(gridKey(zone.map_id, zone.grid_x + dx, zone.grid_y + dy, gz));
  const horiz = joined(1, 0) || joined(-1, 0);
  // An isolated wall tile joins nothing and still has to be a wall: stand a lone
  // vertical post, which is the call plugins/flight/state.js makes with its `|| 'ns'`
  // fallback rather than letting the barrier disappear for a tile.
  const vert = joined(0, -1) || joined(0, 1) || !horiz;
  const faces = new Set();
  if (horiz) faces.add(zone.grid_y > mid.y ? 's' : 'n');
  if (vert) faces.add(zone.grid_x > mid.x ? 'e' : 'w');
  return ['n', 'e', 's', 'w'].filter(d => faces.has(d)).join('');
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
  butcher: 'bldg_butcher',
  comic_shop: 'bldg_comics',
  // The Reach (docs/../memory: project_the_reach) — the frontier town's Main Street. These are
  // trades the rest of the world runs out of a corner of some other building and the Reach gives
  // a whole false front to, which is the entire point of how the place looks.
  mercantile: 'bldg_mercantile', assay: 'bldg_assay', undertaker: 'bldg_undertaker',
  bathhouse: 'bldg_bathhouse',
  // Terminus (docs/proposals/terminus.md). The Exodus grow their own food behind the wall; the
  // glasshouses are the only thing tall enough to be seen from the apron. Registered NOW rather
  // than backfilled later: in pass 1 they are `is_building` mass and never reach this table (it is
  // gated on the facade tag), but the moment pass 2 makes one enterable it needs a code, and a
  // building whose icon arrives in a later build is a building that was briefly wrong on the map.
  greenhouse: 'bldg_warehouse',
  // The Yards — semi-industrial freight district (docs/proposals/yards.md).
  // THE LONG HAUL — the depot is a forwarding shed with truck bays, which is what that glyph is.
  truck_depot: 'bldg_forwarder',
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
/**
 * The piece this tile's adjacency implies, as `<family>_<sides>`.
 *
 * THE LETTERS ARE THE SIDES THAT JOIN, in every family, always. A road draws arms
 * toward those sides; a cliff draws a FACE on the sides that are missing from them.
 * Both families ship 16 pieces under the identical naming rule, and the inversion
 * lives entirely in the art — which is the only reason a second family costs a
 * directory of SVGs and not a branch in this pass.
 *
 * That matters more than it looks. If `cliff_ns` meant "faces north and south" and
 * `road_ns` meant "joins north and south", then one payload would carry two meanings
 * depending on who read it, and the Studio, the minimap, the tablet and this file
 * would each have to know which. They do not: the payload means one thing, and a
 * renderer that can draw a road can draw a cliff by loading a different directory.
 */
export const autoTileName = (at, family = 'road') => {
  const s = ['n', 'e', 's', 'w'].filter((d) => at?.[d]).join('');
  return s ? `${family}_${s}` : `${family}_x`;   // no neighbours ⇒ the lone piece
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
export function deriveFeature(zone, autoTile = null, family = 'road') {
  return featureProvenance(zone, autoTile, family).name;
}

// Which piece set a tile's terrain draws from. One line, exported, because three
// callers need the answer and the fourth copy of it would be the one that drifts.
export function autoTileFamily(zone, palette) {
  return paletteEntry(zone, palette)?.auto_tile_family || 'road';
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
export function featureProvenance(zone, autoTile = null, family = 'road') {
  const implied = autoTile ? autoTileName(autoTile, family) : null;
  const authored = zone?.flags?.icon;
  if (authored) {
    const name = String(authored);
    // SAME-FAMILY ONLY, read off the names themselves rather than hardcoding 'road'.
    // The rule never was about roads: a pinned piece is stale when its neighbours
    // have moved on WITHIN ITS OWN PIECE SET, and `runway_ns` beside road lanes is a
    // deliberate choice of a different set. Spelling that as `startsWith('road_')`
    // happened to be correct while road was the only family; with a second one it
    // would call every hand-pinned cliff piece current, forever.
    const stale = !!implied && name.split('_')[0] === implied.split('_')[0] && implied !== name;
    return { source: 'authored', name, implied, stale };
  }
  const rooftop = buildingIconSvg(zone);
  if (rooftop) return { source: 'rooftop', name: rooftop, implied, stale: false };
  if (autoTile) return { source: 'auto', name: implied, implied, stale: false };
  return { source: null, name: null, implied, stale: false };
}

/**
 * What this tile draws, or null. Three kinds, because the overlay toggle treats
 * them differently — and the split is now DERIVED vs AUTHORED, which is a
 * property of where the glyph came from rather than of where the tile sits:
 *
 *   building  a navigable 2-letter code, derived from the name (Labels mode turns
 *             the tile into that box). A human may override the code; it is still
 *             a code, so it still follows the toggle
 *   room      an apartment designation / floor, derived from the unit name — a
 *             code, but not a landmark
 *   mark      the tile's own drawing, and the ONLY kind a human can create: it
 *             exists iff `zones.marker` is authored. Never toggled off, because a
 *             glyph someone deliberately placed is structure, not an annotation
 *
 * `mark` replaced a `kind: 'art'` that meant "this tile is in the sewers", tested
 * by id prefix + negative grid_z. That category had exactly one client, and its
 * stated justification (keeping road connectors from vanishing in Labels mode) was
 * never the mechanism protecting them — roads carry no label at all and draw from
 * `spec.feature`, which no overlay mode touches. What it did do was classify 34
 * hand-placed room symbols as corridor structure and make them undismissable.
 *
 * The rule that replaces it is general: author a marker on ANY tile and it draws,
 * anywhere on any map. Exactly one tile outside the sewers relies on that — the
 * Echelon's ⛴ on map_world, which is the point of the field. The only other
 * candidate was `CF` on the Citadel's Marble Hall, an acronym duplicating its
 * building's own code on an interior room; it was deleted rather than exempted,
 * because a kind that needs an exception list is the thing being removed here.
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
  const kind = isBuildingTile(zone) ? 'building' : (zone?.flags?.is_apartment ? 'room' : 'mark');
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
  const family = entry?.auto_tile_family || 'road';
  // The two layers that stand on the ground. Both present-iff, so a renderer tests
  // for the layer instead of testing a null against five thousand tiles.
  const feature = deriveFeature(zone, autoTile, family);
  if (feature) spec.feature = feature;
  const label = deriveLabel(zone, palette, ctx);
  if (label) spec.label = label;
  // The overlay layer. NOT `feature`: that slot is a single winner-takes-all
  // precedence chain (authored icon > rooftop > auto), and the wall does not compete
  // with the tile's own drawing — it stands ON a tile that keeps its ground, its
  // terrain and, at the gate, its road piece. Sharing the slot would have had one of
  // the two silently delete the other, and which one won depended on the tile.
  const curtain = deriveCurtain(zone, ctx);
  if (curtain) spec.curtain = curtain;
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
  const ctx = { buildingMarkers, byCell: buildCellIndex(sorted), curtain: buildCurtainIndex(sorted) };
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
    const prov = featureProvenance(zone, spec.auto_tile ?? null, autoTileFamily(zone, palette));
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
