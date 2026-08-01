// Give the per-tile presentation override back its rung.
//
//   node scripts/content/tile-override-cleanup.mjs [--dry-run]
//
// IDEMPOTENT — a second run writes nothing. Files only; there is no database in
// this process. See docs/proposals/tile-presentation-overrides.md.
//
// THE PROBLEM. `marker`, `color` and `bg_color` are described in the field
// catalog as overrides of the terrain palette, and for most tiles they are not:
// derive asks the palette first and throws the authored value away. That is not
// a bug in derive — it is a guardrail, because those columns were bulk-populated
// by pre-terrain tooling and derive cannot tell that fill from authorship. The
// guardrails are doing the job of a data cleanup, and they stand exactly where
// the deliberate override belongs.
//
// THE ARGUMENT THIS SCRIPT RESTS ON. Anything derive currently discards CANNOT
// be a deliberate override, because no author has ever seen one work — it has
// been inert for the whole life of the derive pass. So clearing it destroys no
// authorship, and once it is cleared the guardrails have nothing left to guard
// and can be deleted. The values that DO render are the working set and are not
// touched.
//
// THE RULES ARE FROZEN HERE ON PURPOSE. This script hardcodes the legacy
// precedence rather than importing `resolveTerrain`/`deriveColors`, because the
// commit that runs it is the commit that deletes them. A one-shot has to be a
// standing statement of what it did, auditable years later, not a function of
// code that changed underneath it in the same push.
//
// PHASE A — backfill the green-background terrain inference.
//   `resolveTerrain` reads `grass` out of a green-dominant `bg_color`, a bridge
//   built when tiles had colours but no terrain painter. It is harmless today
//   only because nobody turns `bg_color`; the whole point of this change is to
//   make it a knob authors turn freely, at which point tinting a room green
//   would silently reclassify the tile — and `flags.terrain` is the SSOT
//   `resolveProps` reads. Cosmetics must read from terrain, never write back to
//   it. So the 42 tiles resolving that way say it in the flag instead, and the
//   rung goes.
//
//   These are mostly INTERIORS whose wall colour is sage (`zone_meridian_floor_*`,
//   a clone facility). Writing `terrain: grass` onto an interior floor preserves
//   today's behaviour exactly — which is the point, this pass must not change a
//   pixel — but it does make a questionable classification explicit and therefore
//   reviewable. Correcting them is content work, deliberately left out of a
//   migration whose whole warranty is zero delta.
//
// PHASE B — clear what has never rendered.
//   3,484 fills, 860 markers, 150 marker colours. All three columns are
//   `omitWhenNull`, so the keys LEAVE the files rather than becoming null;
//   content:lint errors on a null override.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

const DRY = process.argv.includes('--dry-run');
const ZONES = join(CONTENT_DIR, 'zones');
const palette = JSON.parse(readFileSync(join(CONTENT_DIR, 'map', 'terrain.json'), 'utf8'));

// The three terrains the palette let a tile's own fill win on, frozen here as a
// LITERAL rather than read from `entry.authored_bg_wins`. The same commit that
// runs this script deletes that key from terrain.json, so reading it live made
// this script's behaviour depend on which half of the commit had landed — and
// once the key was gone, `!entry.authored_bg_wins` was true for every terrain and
// the pass cleared 1,374 fills that were rendering perfectly well. Frozen rules
// only; nothing here may read a file the commit edits.
const AUTHORED_BG_WINS = new Set(['grass', 'water', 'underwater']);

// The green-dominant rung, verbatim from resolveTerrain as it stood before this
// commit. `g - b >= 15` keeps teal docks out.
function greenSurface(zone) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(zone?.bg_color || '');
  if (!m) return null;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return (g > r && g - b >= 15 && g >= 45) ? 'grass' : null;
}

// resolveTerrain as it stood before this commit, green rung included.
function legacyTerrain(zone) {
  const f = zone?.flags || {};
  if (f.terrain) return f.terrain;
  if (f.pier) return 'dock';
  if (/^(road_|runway_)/.test(f.icon || '')) return 'road';
  if (Object.prototype.hasOwnProperty.call(f, 'facade') && String(f.building_type || '')) return null;
  return greenSurface(zone);
}

const files = readdirSync(ZONES).filter((n) => n.endsWith('.json'));
const stats = { backfilled: 0, bg: 0, color: 0, marker: 0, written: 0 };
const backfilledIds = [];

for (const name of files) {
  const path = join(ZONES, name);
  const zone = JSON.parse(readFileSync(path, 'utf8'));
  let touched = false;

  // ── Phase A ───────────────────────────────────────────────────────────────
  if (!zone.flags?.terrain && legacyTerrain(zone) === 'grass' && greenSurface(zone) === 'grass') {
    zone.flags = { ...(zone.flags || {}), terrain: 'grass' };
    stats.backfilled++; backfilledIds.push(zone.id); touched = true;
  }

  // ── Phase B ───────────────────────────────────────────────────────────────
  // Resolved AFTER phase A, so a backfilled tile is judged as the grass tile it
  // now says it is — grass keeps its authored fill, exactly as it does today.
  const terrain = legacyTerrain(zone);
  const entry = terrain ? palette?.terrains?.[terrain] : null;

  // deriveColors asked the palette first: the tile's fill was reached only
  // through the authored_bg_wins exception (grass, water, underwater).
  if (zone.bg_color != null && entry && !AUTHORED_BG_WINS.has(terrain)) {
    delete zone.bg_color; stats.bg++; touched = true;
  }
  // ...and the tile's glyph colour only where the terrain dictated none. A road
  // dictates its markings; everywhere else the authored colour already won.
  if (zone.color != null && entry && entry.text != null) {
    delete zone.color; stats.color++; touched = true;
  }
  // deriveLabel dropped any marker on painted ground — 860 terrain decorations
  // (`#` on grass, `≈` on water, road hatching) the map has never drawn.
  if (zone.marker != null && terrain) {
    delete zone.marker; stats.marker++; touched = true;
  }

  if (touched) {
    stats.written++;
    if (!DRY) writeFileSync(path, canonicalJson(zone), 'utf8');
  }
}

console.log(`scanned ${files.length} zone file(s)`);
console.log(`  phase A  terrain backfilled: ${stats.backfilled}`);
if (backfilledIds.length) {
  console.log(`           ${backfilledIds.slice(0, 6).join(', ')}${backfilledIds.length > 6 ? `, +${backfilledIds.length - 6} more` : ''}`);
}
console.log(`  phase B  bg_color cleared: ${stats.bg} · color cleared: ${stats.color} · marker cleared: ${stats.marker}`);
console.log(stats.written
  ? `${DRY ? 'would rewrite' : 'rewrote'} ${stats.written} file(s)`
  : 'nothing to do — already clean');
