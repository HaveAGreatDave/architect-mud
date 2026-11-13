// One-shot: register the chess table in John Akerson's penthouse (the Solenne, floor 35).
//
// The table and its two chairs ship through content (furn_penthouse_chess_*). The `game_tables`
// row is runtime-classified and not carried by content:import, so it goes in here, as the salon's
// does (scripts/seed-solenne-chess.mjs). Idempotent and converging: a re-run refreshes the config
// and never touches a game in progress.
//
// `practice` makes Akerson the table's regular (plugins/gametable/chess-practice.js): while nobody
// is seated he sits in his chair and plays himself, and he plays you if he knows you at least as
// well as `tier`. `minBet: 0` because it's his kitchen table, not a salon.
//
//   local:  node scripts/seed-akerson-chess.mjs
//   prod:   node --env-file=.env.prod scripts/seed-akerson-chess.mjs
import 'dotenv/config';
import { query } from '../server/models/db.js';

const TABLE_ID = 'gametable_akerson_chess';
const ZONE_ID = 'zone_solenne_penthouse';
const NAME = "Akerson's Board";

const CONFIG = {
  minBet: 0,
  stake: 0,
  moveTimerSecs: 180,
  rematchDelaySecs: 20,
  practice: { npc: 'npc_john_akerson', chair: 'furn_penthouse_chess_chair_host', tier: 'known' },
};

async function main() {
  const { rows } = await query('SELECT id FROM game_tables WHERE id=$1', [TABLE_ID]);
  if (rows.length) {
    await query("UPDATE game_tables SET zone_id=$2, name=$3, game_type='chess', config=$4, updated_at=NOW() WHERE id=$1",
      [TABLE_ID, ZONE_ID, NAME, JSON.stringify(CONFIG)]);
    console.log(`[update] game_table ${TABLE_ID}`);
  } else {
    await query("INSERT INTO game_tables (id,zone_id,name,game_type,config,state,phase) VALUES ($1,$2,$3,'chess',$4,'{}','WaitingForPlayers')",
      [TABLE_ID, ZONE_ID, NAME, JSON.stringify(CONFIG)]);
    console.log(`[create] game_table ${TABLE_ID}`);
  }
  console.log('Done. Restart the server so the table loads.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
