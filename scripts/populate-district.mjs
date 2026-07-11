// One-shot: populate the generated 888-zone district with life.
//
// The zone-planner ships the district as bare geometry (terrain, roads, relocated
// building facades) — 0 furniture, 0 spawns, 0 scav, 4 NPCs. Every system needed to
// bring it alive already exists and is CONTENT-gated; this script just wires the
// district tiles into those gates. It edits content/<table>/*.json directly (git is
// the source of truth) using the pipeline's own canonicalJson() so the diff is clean.
//
//   node scripts/populate-district.mjs          # dry-run: classify + print the plan
//   node scripts/populate-district.mjs --write   # rewrite the JSON files
//
// Four slices (see docs/systems-world.md → "The district"):
//   A Aliveness   — street_life on walkable tiles; fix mis-themed ambient
//   B Livelihoods — fishing on piers, scavenging on streets + a ring of grass
//   C Danger      — land-use-keyed zone_spawns (light-touch gradient)
//   D Identity    — flags.district sub-neighbourhoods via EXISTING registry keys
//
// Idempotent: re-running produces the same bytes (deterministic ids + subset hash).

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, CONTENT_DIR } from './content/lib.mjs';

const WRITE = process.argv.includes('--write');
const ZONES_DIR = join(CONTENT_DIR, 'zones');
const SPAWNS_DIR = join(CONTENT_DIR, 'zone_spawns');

// ── Load every district zone ────────────────────────────────────────────────
const files = readdirSync(ZONES_DIR).filter(f => f.includes('district') && f.endsWith('.json'));
const zones = files.map(f => ({ file: join(ZONES_DIR, f), z: JSON.parse(readFileSync(join(ZONES_DIR, f), 'utf8')) }));
const byXY = new Map(); // "x,y" -> zone (grid_z is 0 for the whole surface district)
for (const { z } of zones) byXY.set(`${z.grid_x},${z.grid_y}`, z);

// ── Classify a tile by its authored signals ─────────────────────────────────
function classOf(z) {
  const fl = z.flags || {}, n = z.name || '';
  if (fl.water) return 'water';
  if (fl.facade || fl.is_building) return 'building';
  if (fl.runway || /^Runway/.test(n)) return 'runway';
  if (/^Grasslands/.test(n)) return 'grass';
  if (/^Pier/.test(n)) return 'pier';
  if (/^Residential/.test(n)) return 'residential';
  return 'street';
}
const WALKABLE = new Set(['street', 'residential', 'pier', 'grass', 'building', 'runway']);
const NEIGHBOURS = [[0, -1], [0, 1], [1, 0], [-1, 0]];
function neighbourClasses(z) {
  const out = [];
  for (const [dx, dy] of NEIGHBOURS) {
    const t = byXY.get(`${z.grid_x + dx},${z.grid_y + dy}`);
    if (t) out.push(classOf(t));
  }
  return out;
}
// Deterministic 0..99 from a string — for light-touch subset selection (idempotent).
function hash100(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 100;
}

// ── Sub-district identity (existing DISTRICTS keys — no engine change) ────────
// Geography, not flat nearest-anchor: a northern Docks strip along the water, a
// Residential pocket around the housing cluster, the Wastes over the open flats.
const ANCHOR_DISTRICT = { pier: 'docks', grass: 'wasteland', residential: 'residential' };
const anchors = zones.map(({ z }) => ({ z, cls: classOf(z) })).filter(a => ANCHOR_DISTRICT[a.cls]);
const residentialTiles = zones.map(({ z }) => z).filter(z => classOf(z) === 'residential');
function distToResidential(z) {
  let best = Infinity;
  for (const r of residentialTiles) best = Math.min(best, Math.abs(r.grid_x - z.grid_x) + Math.abs(r.grid_y - z.grid_y));
  return best;
}
function nearestDistrict(z) { // fallback for through-roads far from any land-use
  let best = 'wasteland', bestD = Infinity;
  for (const a of anchors) {
    const d = Math.abs(a.z.grid_x - z.grid_x) + Math.abs(a.z.grid_y - z.grid_y);
    if (d < bestD) { bestD = d; best = ANCHOR_DISTRICT[a.cls]; }
  }
  return best;
}

// ── Mutate, tracking a summary ──────────────────────────────────────────────
const summary = { street_life: 0, theme: 0, fishing: 0, scav: {}, district: {}, spawns: {} };
const spawnRows = []; // {zone_id, enemy_id, max_count, spawn_weight, respawn_seconds}
function addSpawn(z, enemy_id, max_count, spawn_weight, respawn_seconds) {
  spawnRows.push({ zone_id: z.id, enemy_id, max_count, spawn_weight, respawn_seconds });
  summary.spawns[enemy_id] = (summary.spawns[enemy_id] || 0) + 1;
}
function bumpScav(t) { summary.scav[t] = (summary.scav[t] || 0) + 1; }

for (const { z } of zones) {
  const cls = classOf(z);
  const fl = z.flags = z.flags || {};
  delete fl.scav_table_id; // scrub the bogus flag a prior run wrote — the engine reads scavenging_table_id
  const nb = neighbourClasses(z);
  const nearWater = nb.includes('water');
  const walkableNonGrass = nb.some(c => c !== 'grass' && c !== 'water' && WALKABLE.has(c));

  // ── Slice D — sub-district identity (geographic layering) ──
  const district = cls === 'water' ? 'water'
    : (cls === 'pier' || nearWater) ? 'docks'              // shoreline strip
    : cls === 'residential' || distToResidential(z) <= 3 ? 'residential' // housing pocket
    : cls === 'grass' ? 'wasteland'                        // the open flats
    : nearestDistrict(z);                                  // through-roads / runway
  if (fl.district !== district) { fl.district = district; summary.district[district] = (summary.district[district] || 0) + 1; }

  // ── Slice A — aliveness ──
  if (cls === 'street' || cls === 'residential' || cls === 'pier') {
    if (!fl.street_life) { fl.street_life = true; summary.street_life++; }
  }
  // Fix mis-themed ambient (city has content, but coast has NONE; grass reads urban)
  const newTheme = cls === 'pier' ? 'waterfront' : cls === 'grass' ? 'forest' : cls === 'residential' ? 'residential' : null;
  if (newTheme && z.ambient_theme !== newTheme) { z.ambient_theme = newTheme; summary.theme++; }

  // ── Slice B — livelihoods ──
  if (cls === 'pier') {
    if (fl.fishing_table_id !== 'fish_coldwater_bay') { fl.fishing_table_id = 'fish_coldwater_bay'; summary.fishing++; }
  } else if (cls === 'street') {
    const tbl = nearWater ? 'scav_harbor' : 'scav_roadside_junk';
    if (fl.scavenging_table_id !== tbl) { fl.scavenging_table_id = tbl; bumpScav(tbl); }
  } else if (cls === 'residential') {
    if (fl.scavenging_table_id !== 'scav_consumer_trash') { fl.scavenging_table_id = 'scav_consumer_trash'; bumpScav('scav_consumer_trash'); }
  }
  // Light-touch grass: only the RING (grass touching a walkable non-grass tile) is
  // activated; the deep interior stays deliberate empty wilderness.
  const ringGrass = cls === 'grass' && walkableNonGrass;
  if (ringGrass) {
    if (fl.scavenging_table_id !== 'scav_west_wastes') { fl.scavenging_table_id = 'scav_west_wastes'; bumpScav('scav_west_wastes'); }
  }

  // ── Slice C — danger (land-use gradient, deterministic ~half of eligible tiles) ──
  const roll = hash100(z.id);
  if (cls === 'pier' && roll < 60) addSpawn(z, 'enemy_harbor_lurker', 1, 60, 260);
  else if (cls === 'street' && nearWater && roll < 45) addSpawn(z, 'enemy_cable_eel', 1, 50, 300);
  else if (ringGrass && nearWater && roll < 40) addSpawn(z, 'enemy_rad_mutant', 1, 40, 340); // frontier edge = heavier
  else if (ringGrass && roll < 55) addSpawn(z, 'enemy_ash_crawler', 2, 60, 260);
  else if (cls === 'residential' && roll < 35) addSpawn(z, 'enemy_gutter_cat', 1, 50, 300);
  else if (cls === 'street' && roll < 22) addSpawn(z, 'enemy_feral_dog', 1, 40, 320);
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`District zones: ${zones.length}`);
console.log('Slice A  street_life set:', summary.street_life, ' themes fixed:', summary.theme);
console.log('Slice B  fishing piers:', summary.fishing, ' scav:', summary.scav);
console.log('Slice C  spawns:', summary.spawns, ` (${spawnRows.length} rows)`);
console.log('Slice D  district tags:', summary.district);

// ── Write ────────────────────────────────────────────────────────────────────
if (!WRITE) { console.log('\n(dry-run — pass --write to apply)'); process.exit(0); }

for (const { file, z } of zones) writeFileSync(file, canonicalJson(z));
for (const r of spawnRows) {
  const id = `zs_district_${r.zone_id.replace(/^zone_/, '')}_${r.enemy_id.replace(/^enemy_/, '')}`;
  writeFileSync(join(SPAWNS_DIR, `${id}.json`), canonicalJson({ id, ...r }));
}
console.log(`\n✓ Wrote ${zones.length} zone files + ${spawnRows.length} zone_spawns rows.`);
