/**
 * One-shot: seed Marta Velk's active shelf from her catalogue.
 *
 * Velk's Pre-Owned Furnishings shipped with an empty `vendor_inventory`, so the
 * shop sold nothing at all. The catalogue now lives in content/, but
 * `vendor_stock` is runtime state (excluded from the content pipeline) and the
 * 24h restock tick only adds vendor_restock_rate items per day — a showroom
 * would take a week to fill. This puts the whole floor out at once.
 *
 * Local:  node scripts/fill-velk-shelf.mjs
 * Prod:   node --env-file=.env.prod scripts/fill-velk-shelf.mjs
 */
import { query } from '../server/models/db.js';

const { rowCount } = await query(
  `UPDATE npcs
      SET vendor_stock = (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id', e->>'item_id')), '[]'::jsonb)
              FROM jsonb_array_elements(vendor_inventory) e
          )
    WHERE id = 'npc_marta_velk'`
);
const { rows } = await query(
  `SELECT jsonb_array_length(vendor_stock) AS shelf FROM npcs WHERE id='npc_marta_velk'`
);
console.log(`[velk] ${rowCount} row(s) updated — shelf now ${rows[0]?.shelf} items.`);
process.exit(0);
