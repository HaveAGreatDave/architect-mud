// One-shot: put a shoddy door on every building entrance (exterior → interior)
// and a matching one on the interior side (interior → exterior). A building is
// the entry zone of an interior map; its exterior is that map's parent_zone_id.
// Reads live state, so it respects any relocation already applied. Idempotent:
// existing doors on an (zone, dir) are left untouched — only gaps get a door.
//
//   node scripts/add-shoddy-building-doors.mjs                    (local dev DB)
//   node --env-file=.env.prod scripts/add-shoddy-building-doors.mjs   (prod)
import { query } from '../server/models/db.js';

const { rows: maps } = await query(
  `SELECT id, parent_zone_id, entry_zone_id FROM maps WHERE entry_zone_id IS NOT NULL AND parent_zone_id IS NOT NULL`);

const zoneIds = new Set();
for (const m of maps) { zoneIds.add(m.parent_zone_id); zoneIds.add(m.entry_zone_id); }
const { rows: zones } = await query('SELECT id, exits FROM zones WHERE id = ANY($1::text[])', [[...zoneIds]]);
const zById = new Map(zones.map(z => [z.id, z]));

const { rows: doors } = await query('SELECT zone_id, exit_dir FROM doors');
const has = new Set(doors.map(d => `${d.zone_id}|${d.exit_dir}`)); // an entrance already gated

// The exit direction on `zone` whose target is `targetId` (arrays = multi-exit).
const dirTo = (zone, targetId) => {
  for (const [dir, tgt] of Object.entries(zone?.exits || {})) {
    const arr = Array.isArray(tgt) ? tgt : [tgt];
    if (arr.includes(targetId)) return dir;
  }
  return null;
};

// Collect the (zone, dir, target) entrances that need a door, de-duped.
const want = new Map(); // "zone|dir" -> { zone, dir, target }
const add = (zone, dir, target) => {
  const k = `${zone}|${dir}`;
  if (has.has(k) || want.has(k)) return;
  want.set(k, { zone, dir, target });
};
for (const m of maps) {
  const E = m.parent_zone_id, Z = m.entry_zone_id;
  add(E, dirTo(zById.get(E), Z) || 'in', Z);   // entrance: exterior → interior
  add(Z, dirTo(zById.get(Z), E) || 'out', E);  // reverse:  interior → exterior
}

let n = 0;
for (const d of want.values()) {
  const id = `door_shoddy_${d.zone}_${d.dir}`;
  await query(
    `INSERT INTO doors (id, zone_id, exit_dir, door_type, is_open, hp, hp_max, hololock_difficulty, flags, tags, lock_state, is_locked, target_zone)
     VALUES ($1,$2,$3,'shoddy',0,300,300,0,'{}','{}',NULL,0,$4)
     ON CONFLICT (id) DO NOTHING`,
    [id, d.zone, d.dir, d.target]);
  n++;
}
console.log(`buildings scanned: ${maps.length}`);
console.log(`shoddy doors created: ${n} (entrances already doored were skipped)`);
process.exit(0);
