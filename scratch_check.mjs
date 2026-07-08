import { query } from './server/models/db.js';
const b = await query('SELECT * FROM job_boards');
console.log('boards:', JSON.stringify(b.rows, null, 2));
const q = await query('SELECT id,name,repeatable FROM quests');
console.log('quests:', JSON.stringify(q.rows, null, 2));
const wf = await query("SELECT * FROM world_flags WHERE flag_key LIKE 'jobboard_rot_%'");
console.log('rot flags:', JSON.stringify(wf.rows, null, 2));
process.exit(0);
