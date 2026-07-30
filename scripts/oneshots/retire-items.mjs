/**
 * One-shot: delete item rows whose content files have been retired.
 *
 * WHY THIS EXISTS. The CODEX pipeline is additive (`INSERT … ON CONFLICT DO
 * UPDATE`) — it creates and updates rows but can NEVER delete one. Removing
 * `content/items/<id>.json` stops the item being re-seeded and nothing more; the
 * row sits in every database that already has it, still sellable, still
 * lootable, still showing up in searches. Deleting existing rows is exactly the
 * "data transformation" case CLAUDE.md reserves manual one-shots for.
 *
 * Supersedes `drop-biglazergun.mjs` (that id is included below).
 *
 * SAFETY. Refuses any id that a player actually holds, rather than leaving a
 * dangling `player_inventory.item_id`. It reports and skips, so one held item
 * cannot block the rest.
 *
 * Local:  node scripts/oneshots/retire-items.mjs
 * Prod:   node --env-file=.env.prod scripts/oneshots/retire-items.mjs
 *
 * Converging: safe to run repeatedly; a no-op once the rows are gone.
 */
import { query } from '../../server/models/db.js';

const RETIRED = [
  // Leftover test content: description null, tags {description:"test"}, value 0,
  // no damage. Never a functional weapon. Energy weapons are coming later and
  // will not reuse this id.
  'item_biglazergun',
  // First-pass blade names, replaced by the Grind House catalogue.
  'item_kettleman_no4',
  'item_ripsaw_chaimsword',
  // The "waterproof knife" — the premise was nonsense (a knife has no mechanism
  // to fail). Its role is now the Tidewell speargun, which is actually built for
  // the water.
  'item_tidewell_diving_knife',
  // Renamed to item_ferris_model9 before it ever shipped.
  'item_vorhaus_vh9',
  // Renamed to item_orme_shortsword (the blade carries the smith's marque, not
  // the shop's) before it ever shipped.
  'item_grindhouse_shortsword',
];

let deleted = 0, held = 0, absent = 0;

for (const id of RETIRED) {
  const { rows: present } = await query('SELECT id FROM items WHERE id = $1', [id]);
  if (!present.length) { absent++; continue; }

  const { rows: owned } = await query(
    'SELECT COUNT(*)::int AS c FROM player_inventory WHERE item_id = $1', [id]
  );
  if (owned[0].c > 0) {
    console.error(`[retire-items] SKIP ${id}: ${owned[0].c} player-owned copies exist.`);
    held++;
    continue;
  }

  await query('DELETE FROM items WHERE id = $1', [id]);
  console.log(`[retire-items] deleted ${id}`);
  deleted++;
}

console.log(`[retire-items] ${deleted} deleted, ${held} skipped (owned), ${absent} already absent.`);
process.exit(held ? 1 : 0);
