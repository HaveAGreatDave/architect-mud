// One-shot: put a collectable lighter in a player's pocket.
//
//   node --env-file=.env.prod scripts/oneshots/give-lighter.mjs <handle> [item_id]
//
// The item defaults to item_zippo_black_gold. Player inventory isn't content, so the deploy can't hand
// anybody a lighter; this does, once. It does nothing if they already have that one.
import { query } from '../../server/models/db.js';
import { giveItemById } from '../../server/engine/inventory.js';

const [handle, itemId = 'item_zippo_black_gold'] = process.argv.slice(2);
if (!handle) { console.error('usage: give-lighter.mjs <handle> [item_id]'); process.exit(1); }

const { rows: [item] } = await query('SELECT id, name, tags FROM items WHERE id=$1', [itemId]);
if (!item?.tags?.lighter) { console.error(`${itemId} isn't a lighter in this DB. Import content first.`); process.exit(1); }
const { rows: [p] } = await query('SELECT id, handle FROM players WHERE lower(handle)=lower($1)', [handle]);
if (!p) { console.error(`No player called ${handle}.`); process.exit(1); }
const { rows: had } = await query('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2', [p.id, itemId]);
if (had.length) { console.log(`${p.handle} already has the ${item.name}.`); process.exit(0); }
await giveItemById(p.id, itemId, 1, { stack: false });
console.log(`Gave ${p.handle} the ${item.name}. A player who's online sees it on their next inventory read.`);
process.exit(0);
