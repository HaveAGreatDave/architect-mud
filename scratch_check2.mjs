import { query } from './server/models/db.js';
// simulate takeJob logic manually
const board = (await query('SELECT * FROM job_boards WHERE zone_id=$1', ['zone_city_west'])).rows[0];
console.log('board', board.id);

const rot = JSON.parse((await query("SELECT flag_value FROM world_flags WHERE flag_key=$1", [`jobboard_rot_${board.id}`])).rows[0].flag_value);
console.log('rotated ids', rot.jobs);

const quests = (await query('SELECT * FROM quests WHERE id = ANY($1)', [rot.jobs])).rows;
console.log('quests found', quests.map(q=>q.id));

// fake player id
const fakePlayerId = 'test_player_diag';
const pqs = (await query('SELECT quest_id, status, progress FROM player_quests WHERE player_id=$1 AND quest_id = ANY($2)', [fakePlayerId, rot.jobs])).rows;
console.log('pqs', pqs);
process.exit(0);
