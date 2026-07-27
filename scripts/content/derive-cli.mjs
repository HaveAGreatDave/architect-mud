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
  const [zones, regions] = await Promise.all([
    client.query('SELECT id, marker, color, bg_color, ambient_theme, audio_theme_id, flags FROM zones'),
    client.query('SELECT id, defaults FROM regions'),
  ]);
  await client.query('BEGIN');
  const { rows } = await writeDerived(client, { zones: zones.rows, regions: regions.rows, palette });
  await client.query('COMMIT');
  console.log(`✓ zone_render rebuilt on ${host}: ${rows} rows from ${zones.rowCount} zones.`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`✗ map:derive failed — ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
