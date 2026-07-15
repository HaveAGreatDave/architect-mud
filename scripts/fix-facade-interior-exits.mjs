// Re-key building-interior exits so they face the road, matching the door side the
// engine derives (buildingEntranceDir, which now prefers the first available open
// road). The external district planner sometimes ships an interior whose single
// cardinal out-exit points at the wrong face — e.g. Pawn & Pity / The Neon Vig
// front Marrow Street to the NORTH but shipped a `west` exit, so "leave" and the
// minimap arrow disagreed with where you actually spill out.
//
// Fixes only the unambiguous case: an interior with exactly ONE cardinal exit that
// targets its facade, where the engine knows the road-facing side. Legacy neutral
// `out` exits and buildings with no adjacent road (correctSide === null) are left
// alone — that's the "unless no road is available" carve-out.
//
// Run after importing a freshly-planned district:
//   node scripts/fix-facade-interior-exits.mjs           (local)
//   node --env-file=.env.prod scripts/fix-facade-interior-exits.mjs   (prod)
import { initWorld, world, getZone, buildingEntranceDir, isEnterableFacade } from '../server/engine/world.js';
import { query } from '../server/models/db.js';

const CARDINAL = new Set(['north', 'south', 'east', 'west']);
await initWorld();

const fixes = [];
for (const facade of world.zones.values()) {
  if (!isEnterableFacade(facade)) continue;
  const side = buildingEntranceDir(facade);           // road-facing door side, or null
  if (!side) continue;                                 // no road → leave legacy exit
  const map = [...world.maps.values()].find(m => m.parent_zone_id === facade.id);
  const interior = map ? getZone(map.entry_zone_id) : null;
  if (!interior) continue;

  const outKeys = Object.entries(interior.exits || {})
    .filter(([, t]) => t === facade.id).map(([k]) => k);
  // Only the clean single-cardinal case; skip neutral `out` and multi-exit oddities.
  if (outKeys.length !== 1 || !CARDINAL.has(outKeys[0])) continue;
  if (outKeys[0] === side) continue;                   // already correct

  const next = { ...interior.exits };
  delete next[outKeys[0]];
  next[side] = facade.id;
  fixes.push({ id: interior.id, name: interior.name, from: outKeys[0], to: side, exits: next });
}

if (!fixes.length) { console.log('No mis-keyed interior exits found.'); process.exit(0); }
for (const f of fixes) {
  await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(f.exits), f.id]);
  console.log(`FIXED ${f.id} "${f.name}": ${f.from} → ${f.to}`);
}
console.log(`\nDone. Re-keyed ${fixes.length} interior exit(s). Run \`npm run content:export\` to persist to git.`);
process.exit(0);
