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

// zone_render columns, in the order the multi-row INSERT builds its tuples. Four
// used to sit here that nothing read — `glyph` (a second name for `marker`),
// `color`/`bg_color` (spec.text/spec.fill) and `minimap_class` (spec.minimap_class).
// They are dropped from the table in SCHEMA_SQL; a column here that derive no longer
// produces would insert NULL rather than fail, which is why the list is worth reading
// next to the row deriveWorld builds.
const RENDER_COLS = ['zone_id', 'marker', 'icon', 'ambient_theme', 'audio_theme_id', 'spec'];
const EDGE_COLS = ['from_zone', 'direction', 'to_zone', 'connection_id', 'kind'];

// One batched multi-row INSERT per CHUNK rows. 21,203 separate statements would be
// 21,203 round trips against a remote Postgres — the cost docs/architecture.md
// measures in trips, not in query complexity.
const CHUNK = 500;
async function insertBatched(client, table, cols, rows, jsonCols = new Set()) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = slice.map(r => `(${cols.map(c =>
      `$${params.push(jsonCols.has(c) ? JSON.stringify(r[c] ?? {}) : (r[c] ?? null))}`).join(',')})`);
    await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')}`, params);
  }
}

/**
 * TRUNCATE + rebuild zone_render and zone_edges from the rows handed in.
 *
 * @param {{query: Function}} client  anything with a pg-shaped query(sql, params)
 * @param {object} input              { zones, regions, connections, palette } — see deriveWorld
 * @returns {Promise<{rows: number, edges: number}>}
 */
export async function writeDerived(client, input) {
  const { render, edges } = deriveWorld(input);

  // TRUNCATE, not DELETE + upsert: the whole table is a function of its inputs, so
  // rebuilding it wholesale makes idempotency free and removes the stale-row class
  // entirely (spec §2). Inside the import's transaction this is atomic with the
  // content it derives from.
  await client.query('TRUNCATE zone_render');
  await client.query('TRUNCATE zone_edges');

  const rows = [...render.values()];
  await insertBatched(client, 'zone_render', RENDER_COLS, rows, new Set(['spec']));
  await insertBatched(client, 'zone_edges', EDGE_COLS, edges);
  return { rows: rows.length, edges: edges.length };
}
