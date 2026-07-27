// READ-ONLY census of live keycards. No writes, no DDL — SELECT only.
// Answers map-pipeline-redesign §16.2: does any player hold a `keycard_<door_id>`
// item, and does the door it encodes still exist? Every hit is seed data for the
// per-lock access lists that replace minted keycards.
//   local: node scripts/keycard-census.mjs
//   prod:  node --env-file=<path-to>/.env.prod scripts/keycard-census.mjs
import { query } from '../server/models/db.js';

const say = (label, rows) => {
  console.log(`\n── ${label} ──`);
  if (!rows.length) return console.log('  (none)');
  for (const r of rows) console.log('  ' + JSON.stringify(r));
};

const cat = await query(
  `SELECT count(*)::int AS n FROM items WHERE id LIKE 'keycard\\_%'`);
console.log(`keycard items in catalog: ${cat.rows[0].n}`);

const held = await query(
  `SELECT pi.item_id, count(*)::int AS copies, count(DISTINCT pi.player_id)::int AS holders
     FROM player_inventory pi
    WHERE pi.item_id LIKE 'keycard\\_%'
    GROUP BY pi.item_id
    ORDER BY copies DESC`);
say(`held keycards (${held.rows.length} distinct ids)`, held.rows);

const orphans = await query(
  `SELECT DISTINCT pi.item_id
     FROM player_inventory pi
     LEFT JOIN doors d ON d.id = substring(pi.item_id from 9)
    WHERE pi.item_id LIKE 'keycard\\_%' AND d.id IS NULL`);
say('held keycards whose door NO LONGER EXISTS (orphaned already)', orphans.rows);

const keyed = await query(
  `SELECT id, zone_id, exit_dir, tags FROM doors WHERE tags::text LIKE '%keyItemId%'`);
say(`doors with a keyItemId (${keyed.rows.length})`, keyed.rows.map((r) => ({
  id: r.id, zone: r.zone_id, dir: r.exit_dir,
  keys: Object.entries(r.tags || {}).flatMap(([k, v]) => (v && v.keyItemId ? [`${k}=${v.keyItemId}`] : [])),
})));

const tot = await query(`SELECT
    (SELECT count(*)::int FROM doors) AS doors,
    (SELECT count(*)::int FROM players) AS players,
    (SELECT count(*)::int FROM player_inventory) AS inventory_rows`);
say('scale', tot.rows);
process.exit(0);
