// One-shot data transformation: reset the Embassy poker table's buy-in and
// blinds to the new low-stakes default (₵50 buy-in, ₵5/₵10 blinds). The
// dev panel now edits these live per-table (plugins/gametable/index.js
// /gametable/tables/:id/buyin + /blinds), but the existing gametable_embassy
// row was seeded at ₵200 buy-in / ₵10-₵20 blinds — this rewrites that
// existing row rather than reseeding the whole table+furniture+NPC set.
import 'dotenv/config';
import { query } from '../server/models/db.js';

const TABLE_ID = 'gametable_embassy';
const ZONE_ID = 'zone_residential_lobby';

async function main() {
  const { rows } = await query('SELECT config FROM game_tables WHERE id=$1', [TABLE_ID]);
  if (rows.length) {
    const config = { ...rows[0].config, smallBlind: 5, bigBlind: 10, buyIn: 50 };
    await query('UPDATE game_tables SET config=$1, updated_at=NOW() WHERE id=$2', [JSON.stringify(config), TABLE_ID]);
    console.log(`Updated ${TABLE_ID}: buyIn=50, smallBlind=5, bigBlind=10`);
  } else {
    // `game_tables` is runtime-classified (not in the CODEX content pipeline), so a
    // freshly-restored DB won't have this row unless seed-embassy-poker.js has run.
    // Insert the minimal row here rather than pulling in that whole seed (which also
    // recreates the furniture/chairs/NPC, already present via content/).
    const config = { smallBlind: 5, bigBlind: 10, buyIn: 50, minBuyIn: 50, maxBuyIn: 1000, turnTimerSecs: 30, autoStartDelaySecs: 12 };
    await query(
      "INSERT INTO game_tables (id,zone_id,name,game_type,config,state,phase) VALUES ($1,$2,$3,'holdem',$4,'{}','WaitingForPlayers')",
      [TABLE_ID, ZONE_ID, 'Embassy Poker Table', JSON.stringify(config)]
    );
    console.log(`Created ${TABLE_ID}: buyIn=50, smallBlind=5, bigBlind=10`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
