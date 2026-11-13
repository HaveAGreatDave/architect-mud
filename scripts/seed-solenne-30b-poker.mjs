// One-shot: register the card table in Solenne 30-B as a six-seat Hold'em game.
//
// The table and its six chairs ship through the CODEX content pipeline (git). The `game_tables` row is
// runtime-classified (docs/content-pipeline.md) and isn't carried by content:import, so it goes in
// directly. Idempotent: re-running refreshes the config and leaves a hand in progress alone.
//
//   seats: 6        the felt seats six (GameTable.MAX_SEATS_LIMIT)
//   selfDeal: true  a private flat has no dealer; the players deal it themselves, and a summoned AI
//                   player is seated at once instead of walking up to a locked door
//   view3d: true    the pane carries the table's state for the 3D felt (client panels/poker3d.js)
//
//   local:  node scripts/seed-solenne-30b-poker.mjs
//   prod:   node --env-file=.env.prod scripts/seed-solenne-30b-poker.mjs
import 'dotenv/config';
import { query } from '../server/models/db.js';

const TABLE_ID = 'gametable_solenne_30b';
const ZONE_ID = 'zone_solenne_apt_b';
const NAME = '30-B Card Table';

const CONFIG = {
  seats: 6,
  selfDeal: true,
  view3d: true,
  smallBlind: 5,
  bigBlind: 10,
  buyIn: 200,
  minBuyIn: 50,
  maxBuyIn: 2000,
  turnTimerSecs: 60,
  autoStartDelaySecs: 8,
};

async function main() {
  const { rows } = await query('SELECT id FROM game_tables WHERE id=$1', [TABLE_ID]);
  if (rows.length) {
    await query('UPDATE game_tables SET zone_id=$2, name=$3, config=$4, updated_at=NOW() WHERE id=$1',
      [TABLE_ID, ZONE_ID, NAME, JSON.stringify(CONFIG)]);
    console.log(`[update] game_table ${TABLE_ID}`);
  } else {
    await query("INSERT INTO game_tables (id,zone_id,name,game_type,config,state,phase) VALUES ($1,$2,$3,'holdem',$4,'{}','WaitingForPlayers')",
      [TABLE_ID, ZONE_ID, NAME, JSON.stringify(CONFIG)]);
    console.log(`[create] game_table ${TABLE_ID}`);
  }
  console.log('Done. Restart the server to load the table.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
