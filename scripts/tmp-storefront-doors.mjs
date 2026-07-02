// Add front doors to the storefront buildings entered directly off the street.
// Door sits on the street tile's 'in' edge (matches the earlier dedicated
// entrances), or a named edge for the odd one out. Closed + unlocked.
import { query } from '../server/models/db.js';

const OPP = { in:'out', out:'in', up:'down', down:'up', north:'south', south:'north', east:'west', west:'east' };

// { shop, street, dir(on the street tile toward the shop), name }
const DOORS = [
  { shop: 'zone_mq_pigeon_bar',  street: 'zone_mq_marquee',      dir: 'in', name: 'The Dead Pigeon' },
  { shop: 'zone_mq_sump_bar',    street: 'zone_mq_ember',        dir: 'in', name: 'Sump Front Door' },
  { shop: 'zone_mq_grocery',     street: 'zone_mq_battery',      dir: 'in', name: 'Ration Nine Shopfront' },
  { shop: 'zone_mq_amp_shop',    street: 'zone_mq_overpass',     dir: 'in', name: 'Ampersand Electronics Door' },
  { shop: 'zone_mq_cherry_floor',street: 'zone_mq_cathode',      dir: 'in', name: 'The Glass Cherry Entrance' },
  { shop: 'zone_furniture_store',street: 'zone_thresholdeast',   dir: 'in', name: 'Dead Space Interiors Door' },
  // Embassy hotel front doors: lobby's street edge is 'up' → Franchise Strip.
  { shop: 'zone_residential_lobby', street: 'zone_residential_lobby', dir: 'up', name: 'Embassy Hotel Front Doors' },
];

let added = 0, skipped = 0;
for (const d of DOORS) {
  // Validate the edge exists.
  const { rows: sz } = await query(`SELECT exits FROM zones WHERE id=$1`, [d.street]);
  const tgt = sz[0]?.exits?.[d.dir];
  if (!tgt) { console.log(`SKIP  ${d.name}: ${d.street} has no '${d.dir}' exit`); skipped++; continue; }

  // Existing door on this edge, either side?
  const { rows: ex } = await query(
    `SELECT id FROM doors WHERE (zone_id=$1 AND exit_dir=$2) OR (zone_id=$3 AND exit_dir=$4) LIMIT 1`,
    [d.street, d.dir, tgt, OPP[d.dir]]);
  if (ex.length) { console.log(`SKIP  ${d.name}: edge already has door ${ex[0].id}`); skipped++; continue; }

  const id = `door_entrance_${d.shop}`;
  await query(
    `INSERT INTO doors (id, zone_id, exit_dir, door_type, is_open, hp, hp_max, lock_state, tags, name, flags)
       VALUES ($1,$2,$3,'basic',0,1000,1000,NULL,'{}',$4,'{}')
     ON CONFLICT (id) DO UPDATE SET zone_id=EXCLUDED.zone_id, exit_dir=EXCLUDED.exit_dir, name=EXCLUDED.name`,
    [id, d.street, d.dir, d.name]);
  console.log(`ADD   ${id} on ${d.street} '${d.dir}' → ${tgt}  "${d.name}"`);
  added++;
}
console.log(`\nDone. Added ${added}, skipped ${skipped}.`);
const { rows: t } = await query(`SELECT COUNT(*)::int c FROM doors`);
console.log(`Total doors now: ${t[0].c}`);
process.exit(0);
