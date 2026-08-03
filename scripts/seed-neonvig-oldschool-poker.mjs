// One-shot: register the Lucky Bastard "old-school" text-poker table (the only poker
// table in the casino — it lives in the main room, zone_casino_interior).
//
// The furniture (furn_backroom_poker_table + chairs) and the dealer NPC
// (npc_neonvig_backroom_dealer, "Margo") ship through the CODEX content pipeline
// (git). But the `game_tables` row is runtime-classified
// (docs/content-pipeline.md) — it is NOT carried by content:import — so it has
// to be inserted directly. Idempotent: re-running just refreshes the config.
//
// The distinguishing config key is `textTable: true`: it makes the called-aloud
// log game the OPENING DEFAULT for anyone who sits without a stored preference
// (see plugins/gametable/text-mode.js), and unlocks Margo's "old-school" dealer
// quips (game-table.js OLD_SCHOOL_LINES). It is a default, not a lock — any
// player can flip to the visual felt with `visual` at any table.
//
//   local:  node scripts/seed-neonvig-oldschool-poker.mjs
//   prod:   node --env-file=.env.prod scripts/seed-neonvig-oldschool-poker.mjs
import 'dotenv/config';
import { query } from '../server/models/db.js';

const TABLE_ID = 'gametable_neonvig_oldschool';
const ZONE_ID = 'zone_casino_interior';
const NAME = 'The Old-School Felt';

const CONFIG = {
  smallBlind: 5,
  bigBlind: 10,
  buyIn: 100,
  minBuyIn: 50,
  maxBuyIn: 1000,
  turnTimerSecs: 45,
  autoStartDelaySecs: 12,
  dealerNpcId: 'npc_neonvig_backroom_dealer',
  textTable: true,
};

async function main() {
  const { rows } = await query('SELECT id FROM game_tables WHERE id=$1', [TABLE_ID]);
  if (rows.length) {
    await query(
      'UPDATE game_tables SET zone_id=$2, name=$3, config=$4, updated_at=NOW() WHERE id=$1',
      [TABLE_ID, ZONE_ID, NAME, JSON.stringify(CONFIG)]
    );
    console.log(`[update] game_table ${TABLE_ID}`);
  } else {
    await query(
      "INSERT INTO game_tables (id,zone_id,name,game_type,config,state,phase) VALUES ($1,$2,$3,'holdem',$4,'{}','WaitingForPlayers')",
      [TABLE_ID, ZONE_ID, NAME, JSON.stringify(CONFIG)]
    );
    console.log(`[create] game_table ${TABLE_ID}`);
  }
  console.log('Done. Restart the server (or reload the world) and walk into The Lucky Bastard — Margo runs the felt in the main room.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
