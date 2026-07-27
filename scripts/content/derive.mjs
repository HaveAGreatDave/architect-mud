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

// What gets painted in the cell. The authored marker is an OVERRIDE and wins;
// the palette's glyph is the fallback; painted ground with neither is a seamless
// blank, which is what it already looks like. §7.4 inserts the derived building
// code between these two in step 4.
export function deriveGlyph(zone, palette) {
  if (zone?.marker) return zone.marker;
  return paletteEntry(zone, palette)?.glyph ?? null;
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

  // Sorted iteration: derive must not depend on which rows the upsert happened
  // to touch, or on a Map's insertion order (§7.2).
  for (const zone of [...zones].sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)) {
    const region = zone?.flags?.region_id ? regionById.get(zone.flags.region_id) ?? null : null;
    const { color, bg_color } = deriveColors(zone, palette);
    const resolved = {
      marker: deriveGlyph(zone, palette),
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
  return { render, edges: [], index: null };
}
