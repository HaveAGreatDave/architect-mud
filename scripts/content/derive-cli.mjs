// map:derive — rebuild the generated presentation tables from the live database.
//
//   npm run map:derive
//   node scripts/content/derive-cli.mjs --prod --yes
//
// content:import runs this same pass as step 3 of its transaction, so a normal
// deploy never needs it. It exists for the case the deploy can't cover: a one-shot
// script that rewrites tiles directly (a terrain backfill, a data migration) leaves
// zone_render describing the world as it was. Run this after one, or the map draws
// yesterday.
import 'dotenv/config';
import { connectTarget, readPalette } from './lib.mjs';
import { writeDerived } from './derive-write.mjs';

const args = new Set(process.argv.slice(2));

const { client, host } = await connectTarget({
  prod: args.has('--prod'), yes: args.has('--yes'), purpose: 'rebuild generated map tables ON',
});
try {
  const palette = readPalette();
  if (!palette) console.warn('⚠ no content/map/terrain.json — every tile will derive with an empty palette.');
  // Sequential: one client, and pg queues concurrent queries on it regardless.
  const zones = await client.query(`SELECT id, name, marker, color, bg_color, ambient_theme,
                                           audio_theme_id, flags, map_id, grid_x, grid_y, grid_z, exits
                                    FROM zones`);
  const regions = await client.query('SELECT id, defaults FROM regions');
  const connections = await client.query('SELECT id, a, b, dir, one_way, blocked FROM connections');
  await client.query('BEGIN');
  const { rows, edges } = await writeDerived(client, {
    zones: zones.rows, regions: regions.rows, connections: connections.rows, palette,
  });
  await client.query('COMMIT');
  console.log(`✓ rebuilt on ${host}: zone_render ${rows} rows, zone_edges ${edges} rows`
    + ` (${zones.rowCount} zones, ${connections.rowCount} connections).`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`✗ map:derive failed — ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
