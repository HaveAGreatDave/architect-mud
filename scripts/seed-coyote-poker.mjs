// One-shot: register the poker table at The Coyote's Rest (The Reach's saloon).
//
// The furniture (furn_reach_poker_table + chairs) and the NPCs (dealer Doc Teller,
// gambler Del Roan) ship through the CODEX content pipeline (git). But the
// `game_tables` row is runtime-classified (docs/content-pipeline.md) — NOT carried
// by content:import — so it must be inserted directly. Idempotent: re-running just
// refreshes the config. Mirrors scripts/seed-neonvig-oldschool-poker.mjs.
//
// Old-school called-aloud table (`textTable: true`): the gametable plugin
// force-enables screen-reader text narration for anyone who sits and unlocks the
// dealer's old-school quips — a hand-dealt frontier game that plays by the log.
//
//   local:  node scripts/seed-coyote-poker.mjs
//   prod:   node --env-file=.env.prod scripts/seed-coyote-poker.mjs
import 'dotenv/config';
import { query } from '../server/models/db.js';

const TABLE_ID = 'gametable_coyote';
const ZONE_ID = 'zone_bld_899_1171_lobby';   // The Saloon Floor
const NAME = "The Coyote's Felt";

// Smuggler stakes — a notch above the Neon Vig friendly table. Cash-rich clientele,
// no markers. 10/20 blinds, 200 to sit.
const CONFIG = {
  smallBlind: 10,
  bigBlind: 20,
  buyIn: 200,
  minBuyIn: 100,
  maxBuyIn: 2000,
  turnTimerSecs: 45,
  autoStartDelaySecs: 12,
  dealerNpcId: 'npc_reach_dealer',
  textTable: true,
};

async function main() {
  const { rows } = await query('SELECT id FROM game_tables WHERE id=$1', [TABLE_ID]);
  if (rows.length) {
    await query('UPDATE game_tables SET zone_id=$2, name=$3, config=$4, updated_at=NOW() WHERE id=$1',
      [TABLE_ID, ZONE_ID, NAME, JSON.stringify(CONFIG)]);
    console.log(`[update] game_table ${TABLE_ID}`);
  } else {
    await query(
      "INSERT INTO game_tables (id,zone_id,name,game_type,config,state,phase) VALUES ($1,$2,$3,'holdem',$4,'{}','WaitingForPlayers')",
      [TABLE_ID, ZONE_ID, NAME, JSON.stringify(CONFIG)]);
    console.log(`[create] game_table ${TABLE_ID}`);
  }
  console.log("Done. Reload the world and walk into The Coyote's Rest — Doc Teller runs the felt; sit and summon a gambler.");
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
