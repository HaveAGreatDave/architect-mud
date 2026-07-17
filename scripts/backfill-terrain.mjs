// One-shot data transform: bake today's *inferred* terrain into an explicit
// `flags.terrain` field, so every ground tile is explicitly typed and paintable
// while day-one appearance stays identical. The new `flags.terrain` SSOT
// (zoneTerrain prefers it) is a no-op until rows actually carry the field — this
// fills it in.
//
// Only assigns terrain where it is CONFIDENTLY derivable (water / pier→dock /
// road / grass / yacht→water). Plain streets/lots are left unset so they keep
// rendering from their authored bg_color, exactly as before. Point features
// (statue, boat, helipad, aa, building rooftops) are never folded into terrain.
//
//   Local: node scripts/backfill-terrain.mjs
//   Prod:  node --env-file=.env.prod scripts/backfill-terrain.mjs
//
// Idempotent: skips any zone that already has flags.terrain.

import { query } from '../server/models/db.js';

// Same green-dominant test as zoneTerrain() in server/engine/world.js — a green
// surface colour is authored parkland/grass.
function isGrassColor(bg) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bg || '');
  if (!m) return false;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return g > r && g - b >= 15 && g >= 45;
}

// Derive the ground terrain for a zone from its current signals, or null to leave
// it unset. Mirrors zoneTerrain()'s inference plus the pier→dock and yacht→water
// upgrades called out in the plan.
function deriveTerrain(f, bg_color) {
  if (!f) f = {};
  // Never type building facades / interiors as ground terrain.
  if (f.building_type || f.is_building || f.is_interior || f.is_apartment) return null;
  if (f.yacht) return 'water';                 // the Echelon floats on the water grid
  if (f.water) return 'water';
  if (f.pier) return 'dock';                   // new class — piers were terrain:null before
  if (/^(road_|runway_)/.test(f.icon || '')) return 'road';
  if (f.runway) return 'road';
  if (Array.isArray(f.artery) && f.artery.length) return 'road';
  if (isGrassColor(bg_color)) return 'grass';
  return null;
}

const { rows } = await query(`SELECT id, name, flags, bg_color FROM zones`);
let set = 0, skipped = 0, already = 0;

for (const z of rows) {
  const f = z.flags || {};
  if (f.terrain) { already++; continue; }
  const terrain = deriveTerrain(f, z.bg_color);
  if (!terrain) { skipped++; continue; }
  await query(
    `UPDATE zones
        SET flags = jsonb_set(coalesce(flags, '{}'::jsonb), '{terrain}', $2::jsonb)
      WHERE id = $1`,
    [z.id, JSON.stringify(terrain)],
  );
  set++;
}

console.log(`✓ terrain backfill: ${set} set, ${already} already had terrain, ${skipped} left unset (render from bg_color)`);
process.exit(0);
