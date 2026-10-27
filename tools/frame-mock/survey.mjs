// One-off: list candidate zones for the Frame mockup captures.
import { initWorld, world } from '../../server/engine/world.js';
import pool from '../../server/models/db.js';

await initWorld();
const zones = [...world.zones.values()];
const npcsIn = (zid) => [...world.npcs.values()].filter(n => n.current_zone === zid || n.zone_id === zid);
const sully = world.npcs.get('npc_barkeep');
console.log('sully', sully?.work_zone_id, sully?.current_zone, world.zones.get(sully?.work_zone_id)?.name);
for (const id of ['npc_voltage_bartender', 'npc_greenroom_bartender', 'npc_soup_molly', 'npc_vane']) {
  const n = world.npcs.get(id);
  console.log(id, n?.name, n?.work_zone_id, world.zones.get(n?.work_zone_id)?.name, !!n?.dialogue_tree);
}
const streets = zones.filter(z => z.map_id === 'map_world' && (z.grid_z ?? 0) === 0 && /street|row|lane|road/i.test(z.name || '') && npcsIn(z.id).length);
console.log('streets with npcs:', streets.slice(0, 12).map(z => `${z.id} "${z.name}" npcs=${npcsIn(z.id).length}`).join('\n'));
const withEnemies = zones.filter(z => z.enemies && z.enemies.size).slice(0, 12);
console.log('zones with live enemies:', withEnemies.map(z => `${z.id} "${z.name}" ${[...z.enemies].map(e => world.enemies?.get?.(e)?.name || e).join(',')}`).join('\n'));
await pool.end().catch(() => {});
process.exit(0);
