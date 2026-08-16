/**
 * Items cache — boot-loaded Map of the entire `items` table (authored templates).
 * Mirrors the recipes/drugs caching pattern: DB is source of truth, cached in
 * memory at boot, invalidated by every writer.
 *
 * `items` is a content table (see server/models/content-registry.js) — rows only
 * change through the dev panel plus two runtime minters (surveillance datachips,
 * broadcast cassettes) and their reapers. (Keycard cutting was the third; it was
 * deleted as a mechanism — see map-pipeline-spec §6.) THE CONTRACT: every INSERT/UPDATE against items calls reloadItem(id)
 * (or setItemCache with the full row), and every DELETE calls deleteItemCache(id)
 * — grep the write surface before adding a new writer that skips this.
 *
 * Read side: hot paths (per-move gates, the drowning tick, per-swing weapon
 * resolution, inventory display) look items up here instead of re-JOINing the
 * table; see docs/architecture.md → Read Tiers.
 */
import { query } from '../models/db.js';

let ITEM_CACHE = new Map();

export async function loadItems() {
  // query-lint-ok: this IS the loader that fills the item cache — the one
  // full-table read that lets every other reader skip the DB entirely.
  const { rows } = await query('SELECT * FROM items');
  const cache = new Map();
  for (const it of rows) cache.set(it.id, it);
  ITEM_CACHE = cache;
  return cache;
}

export function getItem(id) { return ITEM_CACHE.get(id); }
export function getItemCache() { return ITEM_CACHE; }
export function deleteItemCache(id) { ITEM_CACHE.delete(id); }

// Re-read one row after an INSERT/UPDATE (row present) or DELETE (row gone).
export async function reloadItem(id) {
  // query-lint-ok: the per-row re-loader for the item cache — every writer's
  // contract is to call this, so it is the one place that must not read cache.
  const { rows } = await query('SELECT * FROM items WHERE id=$1', [id]);
  if (rows.length) ITEM_CACHE.set(id, rows[0]);
  else ITEM_CACHE.delete(id);
  return rows[0] || null;
}
