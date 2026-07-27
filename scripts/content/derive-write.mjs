// The one place a derived world is WRITTEN. Everything about *what* a tile looks
// like lives in derive.mjs and is pure; this file is the impure half — it reads
// rows, calls the pure function, and writes the generated tables.
//
// Keeping the two apart is the enforcement mechanism from spec §7.1: deriveWorld
// is handed plain objects and never sees a client, so a query() written inside it
// has nothing to call. That only holds while this file stays the sole bridge.
//
// Three callers, one code path:
//   - content:import  → step 3 of the import transaction (spec §9)
//   - npm run map:derive → a one-shot's way to un-stale the tables
//   - POST /map/derive → the dev panel, after a terrain paint

import { deriveWorld } from './derive.mjs';

// zone_render columns, in the order the multi-row INSERT builds its tuples.
const RENDER_COLS = ['zone_id', 'marker', 'color', 'bg_color', 'icon', 'ambient_theme',
  'audio_theme_id', 'minimap_class', 'glyph', 'spec'];

/**
 * TRUNCATE + rebuild zone_render from the rows handed in.
 *
 * @param {{query: Function}} client  anything with a pg-shaped query(sql, params)
 * @param {object} input              { zones, regions, palette } — see deriveWorld
 * @returns {Promise<{rows: number}>}
 */
export async function writeDerived(client, input) {
  const { render } = deriveWorld(input);

  // TRUNCATE, not DELETE + upsert: the whole table is a function of its inputs, so
  // rebuilding it wholesale makes idempotency free and removes the stale-row class
  // entirely (spec §2). Inside the import's transaction this is atomic with the
  // content it derives from.
  await client.query('TRUNCATE zone_render');
  if (!render.size) return { rows: 0 };

  // Batched multi-row INSERT. 5,788 separate statements would be 5,788 round trips
  // against a remote Postgres — the exact cost docs/architecture.md measures in
  // trips, not query complexity.
  const rows = [...render.values()];
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = slice.map(r => `(${RENDER_COLS.map(c =>
      `$${params.push(c === 'spec' ? JSON.stringify(r[c] ?? {}) : (r[c] ?? null))}`).join(',')})`);
    await client.query(
      `INSERT INTO zone_render (${RENDER_COLS.join(',')}) VALUES ${tuples.join(',')}`, params);
  }
  return { rows: rows.length };
}
