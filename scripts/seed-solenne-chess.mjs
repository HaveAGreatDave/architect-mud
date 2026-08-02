// One-shot: register the chess table in Material Advantage, the Solenne's
// games salon (floor 18, off the residents' elevator).
//
// The room, the furniture and the lighting all ship through the CODEX content
// pipeline (git). The `game_tables` row is runtime-classified
// (docs/content-pipeline.md) and is NOT carried by content:import, so it has to
// be inserted directly. Idempotent, and CONVERGING — re-running only refreshes
// the config, never a game in progress.
//
// `game_type: 'chess'` is the whole switch: plugins/gametable/tables.js reads it
// and builds a ChessTable instead of a poker felt. Before chess existed the
// column was stored and never read.
//
// `stake: 0` makes this a free board. A staked table is the same row with a
// number in it — winner takes both stakes, a draw returns them. This one is
// free on purpose: the room is the flex, not the wager.
//
//   local:  node scripts/seed-solenne-chess.mjs
//   prod:   node --env-file=.env.prod scripts/seed-solenne-chess.mjs
import 'dotenv/config';
import { query } from '../server/models/db.js';

const TABLE_ID = 'gametable_solenne_chess';
const ZONE_ID = 'zone_solenne_salon';
const NAME = 'The Inlaid Board';

const CONFIG = {
  stake: 0,             // free game; set a number to play for credits
  moveTimerSecs: 180,   // nobody hurries in this room
  rematchDelaySecs: 15, // how long the final position stays up
};

async function main() {
  const { rows } = await query('SELECT id FROM game_tables WHERE id=$1', [TABLE_ID]);
  if (rows.length) {
    await query(
      "UPDATE game_tables SET zone_id=$2, name=$3, game_type='chess', config=$4, updated_at=NOW() WHERE id=$1",
      [TABLE_ID, ZONE_ID, NAME, JSON.stringify(CONFIG)]
    );
    console.log(`[update] game_table ${TABLE_ID}`);
  } else {
    await query(
      "INSERT INTO game_tables (id,zone_id,name,game_type,config,state,phase) VALUES ($1,$2,$3,'chess',$4,'{}','WaitingForPlayers')",
      [TABLE_ID, ZONE_ID, NAME, JSON.stringify(CONFIG)]
    );
    console.log(`[create] game_table ${TABLE_ID}`);
  }
  console.log('Done. Restart the server (or reload the world), then take the Solenne elevator to floor 18.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
