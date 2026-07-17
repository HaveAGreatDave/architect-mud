// One-shot: register the Neon Vig high-stakes poker table.
//
// The table furniture (furn_neonvig_poker_table + chairs) and the dealer NPC
// (npc_neonvig_dealer) ship through the CODEX content pipeline (git). But the
// `game_tables` row is runtime-classified (docs/content-pipeline.md) — it is NOT
// carried by content:import — so, exactly like gametable_embassy, it has to be
// inserted directly. Idempotent: re-running just refreshes the config.
//
//   local:  node scripts/seed-neonvig-poker.mjs
//   prod:   node --env-file=.env.prod scripts/seed-neonvig-poker.mjs
import 'dotenv/config';
import { query } from '../server/models/db.js';

const TABLE_ID = 'gametable_neonvig';
const ZONE_ID = 'zone_casino_interior';

const CONFIG = {
  smallBlind: 10,
  bigBlind: 20,
  buyIn: 250,
  minBuyIn: 100,
  maxBuyIn: 2000,
  turnTimerSecs: 30,
  autoStartDelaySecs: 12,
  dealerNpcId: 'npc_neonvig_dealer',
};

async function main() {
  const { rows } = await query('SELECT id FROM game_tables WHERE id=$1', [TABLE_ID]);
  if (rows.length) {
    await query(
      'UPDATE game_tables SET zone_id=$2, name=$3, config=$4, updated_at=NOW() WHERE id=$1',
      [TABLE_ID, ZONE_ID, 'The High Table', JSON.stringify(CONFIG)]
    );
    console.log(`[update] game_table ${TABLE_ID}`);
  } else {
    await query(
      "INSERT INTO game_tables (id,zone_id,name,game_type,config,state,phase) VALUES ($1,$2,$3,'holdem',$4,'{}','WaitingForPlayers')",
      [TABLE_ID, ZONE_ID, 'The High Table', JSON.stringify(CONFIG)]
    );
    console.log(`[create] game_table ${TABLE_ID}`);
  }
  console.log('Done. Restart the server (or reload the world) and walk into The Neon Vig.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
