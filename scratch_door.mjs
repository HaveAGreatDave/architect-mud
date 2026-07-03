import { query } from './server/models/db.js';
await query(`UPDATE doors SET lock_state=NULL WHERE id='door_5'`);
const { rows } = await query(`SELECT id, lock_state, is_open, tags FROM doors WHERE id='door_5'`);
console.log(JSON.stringify(rows[0]));
process.exit(0);
