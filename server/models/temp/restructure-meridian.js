/**
 * One-shot: restructure Meridian zones.
 *
 * Before: zone_meridian_lobby sits ON the world map as the building entrance.
 *
 * After:
 *   zone_meridian      — "The Meridian"        — NOT on any map, no flags
 *                          exits: (former world exits) + in → zone_meridian_lobby
 *   zone_meridian_lobby — "The Meridian - Lobby" — NOT on world map, parent_zone = zone_meridian
 *                          exits: interior exits + out → zone_meridian
 *
 * World zones that had exits pointing to zone_meridian_lobby are redirected
 * to zone_meridian (the new outer zone).
 *
 * Run once: node server/models/temp/restructure-meridian.js
 */

import { query } from '../db.js';

async function main() {
  // 1. Load current lobby zone
  const { rows: lobbyRows } = await query('SELECT * FROM zones WHERE id=$1', ['zone_meridian_lobby']);
  if (!lobbyRows.length) {
    console.error('zone_meridian_lobby not found — nothing to do');
    process.exit(1);
  }
  const lobby = lobbyRows[0];
  const lobbyExits = typeof lobby.exits === 'string' ? JSON.parse(lobby.exits) : (lobby.exits || {});

  console.log(`Found zone_meridian_lobby: "${lobby.name}" map_id=${lobby.map_id} grid=(${lobby.grid_x},${lobby.grid_y})`);

  // 2. Identify child zones (rooms whose parent_zone = zone_meridian_lobby)
  const { rows: childRows } = await query('SELECT id FROM zones WHERE parent_zone=$1', ['zone_meridian_lobby']);
  const childIds = new Set(childRows.map(z => z.id));
  console.log(`Child zones: ${childRows.map(z => z.id).join(', ') || '(none)'}`);

  // Split lobby exits: world-facing vs interior
  const worldExits = {};   // will go on zone_meridian
  const interiorExits = {}; // will stay on zone_meridian_lobby
  for (const [dir, dest] of Object.entries(lobbyExits)) {
    if (childIds.has(dest) || dir === 'in') {
      interiorExits[dir] = dest;
    } else {
      worldExits[dir] = dest;
    }
  }

  // 3. Create zone_meridian if it doesn't exist
  const { rows: existCheck } = await query('SELECT id FROM zones WHERE id=$1', ['zone_meridian']);
  if (existCheck.length) {
    console.log('zone_meridian already exists — skipping creation');
  } else {
    const meridianExits = { ...worldExits, in: 'zone_meridian_lobby' };
    await query(
      `INSERT INTO zones (id, name, description, danger_rating, pvp_enabled, radiation_level,
        is_safe_zone, exits, ambient_events, ambient_theme, flags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        'zone_meridian',
        'The Meridian',
        lobby.description || 'The imposing exterior of the Meridian complex.',
        lobby.danger_rating || 'safe',
        lobby.pvp_enabled ?? 0,
        lobby.radiation_level ?? 0,
        lobby.is_safe_zone ?? 0,
        JSON.stringify(meridianExits),
        JSON.stringify(lobby.ambient_events || []),
        lobby.ambient_theme || 'outdoors',
        JSON.stringify({}),
      ]
    );
    console.log(`Created zone_meridian with exits: ${JSON.stringify(meridianExits)}`);
  }

  // 4. Update zone_meridian_lobby: rename, remove from map, set parent_zone, fix exits
  const newLobbyExits = { ...interiorExits, out: 'zone_meridian' };
  await query(
    `UPDATE zones SET
       name        = $1,
       map_id      = NULL,
       grid_x      = NULL,
       grid_y      = NULL,
       grid_z      = NULL,
       parent_zone = $2,
       exits       = $3,
       flags       = $4
     WHERE id = $5`,
    [
      'The Meridian - Lobby',
      'zone_meridian',
      JSON.stringify(newLobbyExits),
      JSON.stringify({ is_interior: true }),
      'zone_meridian_lobby',
    ]
  );
  console.log(`Updated zone_meridian_lobby → "The Meridian - Lobby", removed from map, parent=zone_meridian`);
  console.log(`  new exits: ${JSON.stringify(newLobbyExits)}`);

  // 5. Redirect exits in OTHER zones that pointed to zone_meridian_lobby → zone_meridian
  const { rows: refZones } = await query(
    `SELECT id, exits FROM zones WHERE exits::text LIKE '%zone_meridian_lobby%' AND id NOT IN ('zone_meridian_lobby','zone_meridian')`
  );
  for (const z of refZones) {
    const exits = typeof z.exits === 'string' ? JSON.parse(z.exits) : (z.exits || {});
    let changed = false;
    for (const [dir, dest] of Object.entries(exits)) {
      if (dest === 'zone_meridian_lobby') {
        exits[dir] = 'zone_meridian';
        changed = true;
        console.log(`  Redirected ${z.id}.exits.${dir}: zone_meridian_lobby → zone_meridian`);
      }
    }
    if (changed) await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(exits), z.id]);
  }

  console.log('Done. Run `npm run world:reload` or restart the server to pick up zone changes.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
