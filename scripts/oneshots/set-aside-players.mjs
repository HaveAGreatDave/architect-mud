// Players, and what they left, inside a building that has been set aside.
//
//   node scripts/oneshots/set-aside-players.mjs [--dry-run]                       local
//   node --env-file=.env.prod scripts/oneshots/set-aside-players.mjs [--dry-run]  prod
//
// A set-aside building (flags.set_aside, on the holding map map_set_aside; see
// docs/proposals/hughson-coliseum.md) has no way in or out, so anybody standing in one of its rooms
// when it was moved is stranded, and so is anything on its floor. This finds every runtime row that
// points into one, and moves it to the Hughson Coliseum's rotunda, which stands where the
// Coliseum's block was set aside from:
//   - players.current_zone, the room a player is standing in;
//   - players.anchor_zone, where they respawn, back to the default (zone_start);
//   - items on the floor (player_inventory owned by `_ground_<zone>`);
//   - player_corpses.
// Rented rooms (apartments) and player storefronts are LISTED, not moved: either is a deal a
// player made for that room, and it needs a person to decide where it goes.
//
// ⚠ IT CONVERGES. It reads which zones are set aside from the zones table each run, so it stays
// right when another building is set aside later, and a world with nothing in those rooms is a
// no-op. That's what lets it live in scripts/oneshots.bat.
import pool, { query } from '../../server/models/db.js';

const DRY = process.argv.includes('--dry-run');
const TO = 'zone_hughson_rotunda';

const { rows: zs } = await query(`
  SELECT z.id FROM zones z
   WHERE z.map_id = 'map_set_aside'
      OR z.parent_zone IN (SELECT id FROM zones WHERE map_id = 'map_set_aside')`);
const ids = zs.map((r) => r.id);
console.log(`${ids.length} set-aside zone(s)`);
if (!ids.length) { await pool?.end?.(); process.exit(0); }
const { rows: [to] } = await query('SELECT id FROM zones WHERE id = $1', [TO]);
if (!to) { console.error(`✗ ${TO} does not exist here; import the content first`); process.exit(1); }

const grounds = ids.map((id) => `_ground_${id}`);
const [standing, anchored, floor, corpses, flats, shops] = await Promise.all([
  query('SELECT id, username, current_zone FROM players WHERE current_zone = ANY($1)', [ids]),
  query('SELECT id, username, anchor_zone FROM players WHERE anchor_zone = ANY($1)', [ids]),
  query('SELECT COUNT(*)::int AS n FROM player_inventory WHERE player_id = ANY($1)', [grounds]),
  query('SELECT COUNT(*)::int AS n FROM player_corpses WHERE zone_id = ANY($1)', [ids]),
  query('SELECT zone_id FROM apartments WHERE zone_id = ANY($1) OR home_zone = ANY($1)', [ids]).catch(() => ({ rows: [] })),
  query('SELECT zone_id FROM storefronts WHERE zone_id = ANY($1)', [ids]).catch(() => ({ rows: [] })),
]);
console.log(`  standing in one: ${standing.rows.length}${standing.rows.length ? ' (' + standing.rows.map((r) => r.username).join(', ') + ')' : ''}`);
console.log(`  respawning in one: ${anchored.rows.length}`);
console.log(`  items on a floor: ${floor.rows[0].n}`);
console.log(`  corpses: ${corpses.rows[0].n}`);
for (const r of flats.rows) console.log(`  ⚠ rented room ${r.zone_id}: needs a person to decide`);
for (const r of shops.rows) console.log(`  ⚠ storefront ${r.zone_id}: needs a person to decide`);

if (!DRY) {
  await query('UPDATE players SET current_zone = $2 WHERE current_zone = ANY($1)', [ids, TO]);
  await query("UPDATE players SET anchor_zone = 'zone_start' WHERE anchor_zone = ANY($1)", [ids]);
  await query('UPDATE player_inventory SET player_id = $2 WHERE player_id = ANY($1)', [grounds, `_ground_${TO}`]);
  await query('UPDATE player_corpses SET zone_id = $2 WHERE zone_id = ANY($1)', [ids, TO]);
  console.log(`✓ moved to ${TO}`);
} else console.log('(dry run, nothing written)');
await pool?.end?.();
process.exit(0);
