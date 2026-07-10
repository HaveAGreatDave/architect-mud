// Zone-map connectivity + facade lint (read-only). The grid is display-only
// and exits are the traversability law — this report surfaces the places where
// the two disagree (the "GPS-ing a disjointed map" feel), plus every facade
// invariant the auto-forward seam depends on.
//
//   node tools/zone-planner/lint.mjs                (map_world)
//   node tools/zone-planner/lint.mjs --map map_x
import { query } from '../../server/models/db.js';

const args = process.argv.slice(2);
const mapId = args.includes('--map') ? args[args.indexOf('--map') + 1] : 'map_world';

const { rows: zones } = await query('SELECT id, name, map_id, grid_x, grid_y, grid_z, exits, flags FROM zones');
const { rows: maps } = await query('SELECT id, parent_zone_id, entry_zone_id FROM maps');
const { rows: spawns } = await query('SELECT id, zone_id FROM zone_spawns');
const { rows: overrides } = await query('SELECT zone_id, direction, target_zone FROM zone_exit_overrides').catch(() => ({ rows: [] }));

const byId = new Map(zones.map(z => [z.id, z]));
const mapByParent = new Map(maps.filter(m => m.parent_zone_id).map(m => [m.parent_zone_id, m]));
const onMap = zones.filter(z => z.map_id === mapId && z.grid_x != null && z.grid_y != null);
const byXY = new Map(onMap.map(z => [`${z.grid_x},${z.grid_y},${z.grid_z ?? 0}`, z]));
const targetsOf = (exits) => Object.values(exits || {}).flatMap(v => Array.isArray(v) ? v : [v]);
const hasExitBetween = (a, b) => targetsOf(a.exits).includes(b.id) || targetsOf(b.exits).includes(a.id);
const isEnterableFacade = (z) => !!z?.flags?.facade && !!mapByParent.get(z.id)?.entry_zone_id && byId.has(mapByParent.get(z.id)?.entry_zone_id);

const findings = { gaps: [], teleports: [], facades: [], dupes: [] };

// 1. Grid-adjacent walkable tiles with no connecting exit (the disjointed-map smell).
for (const z of onMap) {
  if (z.flags?.is_interior || z.flags?.is_apartment) continue;
  for (const [dir, dx, dy] of [['east', 1, 0], ['south', 0, 1]]) { // each pair once
    const n = byXY.get(`${z.grid_x + dx},${z.grid_y + dy},${z.grid_z ?? 0}`);
    if (!n || n.flags?.is_interior || n.flags?.is_apartment) continue;
    if (!hasExitBetween(z, n)) {
      findings.gaps.push(`${z.id} ↔ ${n.id} — adjacent on the grid, no exit. Fix: add "${dir}": "${n.id}" to ${z.id} (and the opposite back).`);
    }
  }
}

// 2. Cardinal exits between grid-placed tiles that aren't adjacent (teleport-shaped streets).
for (const z of onMap) {
  for (const [dir, tgt] of Object.entries(z.exits || {})) {
    if (!['north', 'south', 'east', 'west'].includes(dir)) continue;
    for (const t of (Array.isArray(tgt) ? tgt : [tgt])) {
      const n = byId.get(t);
      if (!n || n.map_id !== mapId || n.grid_x == null) continue;
      const d = Math.abs(n.grid_x - z.grid_x) + Math.abs(n.grid_y - z.grid_y);
      if ((n.grid_z ?? 0) === (z.grid_z ?? 0) && d !== 1) {
        findings.teleports.push(`${z.id} --${dir}--> ${t} spans ${d} tiles (grid says they aren't neighbours).`);
      }
    }
  }
}

// 3. Facade invariants (the auto-forward seam's dependencies).
for (const z of zones) {
  if (!z.flags?.facade) continue;
  const m = mapByParent.get(z.id);
  if (!m) { findings.facades.push(`${z.id}: facade tag but NO interior map parented on it — tile stays standable.`); continue; }
  if (!m.entry_zone_id || !byId.has(m.entry_zone_id)) findings.facades.push(`${z.id}: interior map ${m.id} has no valid entry_zone_id.`);
  const wez = z.flags?.world_exit_zone;
  if (!wez) findings.facades.push(`${z.id}: enterable facade without world_exit_zone — OUT falls back to landing on the facade.`);
  else if (!byId.has(wez)) findings.facades.push(`${z.id}: world_exit_zone "${wez}" doesn't exist.`);
}
for (const s of spawns) {
  if (isEnterableFacade(byId.get(s.zone_id))) findings.facades.push(`spawn ${s.id} targets enterable facade ${s.zone_id} — nothing can stand there; move it inside or to the street.`);
}

// 4. Runtime exit overrides duplicating authored exits (harmless but noisy drift).
for (const o of overrides) {
  const z = byId.get(o.zone_id);
  if (z && targetsOf({ [o.direction]: z.exits?.[o.direction] }).includes(o.target_zone)) {
    findings.dupes.push(`${o.zone_id} --${o.direction}--> ${o.target_zone} exists both authored and as a runtime override.`);
  }
}

const section = (title, list) => {
  console.log(`\n— ${title} (${list.length})`);
  list.forEach(l => console.log('  ' + l));
};
console.log(`zone-planner lint — map ${mapId}: ${onMap.length} placed zones`);
section('adjacent-but-unconnected walkable tiles', findings.gaps);
section('teleport-shaped cardinal exits', findings.teleports);
section('facade invariant violations', findings.facades);
section('override/authored exit duplicates', findings.dupes);
const total = Object.values(findings).reduce((s, l) => s + l.length, 0);
console.log(`\n${total === 0 ? '✓ clean.' : total + ' finding(s).'}`);
process.exit(0);
