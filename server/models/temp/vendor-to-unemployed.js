/**
 * One-shot: change all vendor-type NPCs to unemployed.
 *
 * Replaces npc_type='vendor' with 'unemployed' and assigns the default
 * unemployed behaviour graph (HAVE_LIFE loop with home sleep cycle).
 *
 * Run AFTER `npm run db:schema` (requires the npc_type column to exist).
 *
 *   node server/models/temp/vendor-to-unemployed.js
 */

import 'dotenv/config';
import { query } from '../db.js';

const UNEMPLOYED_GRAPH = {
  _start: 'start',
  nodes: {
    start:      { type: 'start', next: 'have_life' },
    have_life:  { type: 'action', action_type: 'HAVE_LIFE', next: 'home_check' },
    home_check: { type: 'condition', condition_type: 'AT_HOME', ifTrue: 'home_idle', ifFalse: 'have_life' },
    home_idle:  { type: 'action', action_type: 'AT_HOME_LIFE', next: 'have_life' },
  },
};

async function main() {
  // These are fully set-up vendors — leave them alone.
  const KEEP_AS_VENDOR = ['npc_marta_velk', 'npc_cassius_drum'];

  const { rows } = await query(
    `SELECT id, name FROM npcs WHERE npc_type = 'vendor' AND id != ALL($1)`,
    [KEEP_AS_VENDOR]
  );

  if (!rows.length) {
    console.log('No vendor-type NPCs to convert (fully-set-up vendors are excluded).');
    process.exit(0);
  }

  console.log(`Found ${rows.length} NPC(s) to convert:`);
  for (const r of rows) console.log(`  ${r.id} — ${r.name}`);
  console.log(`Skipping: ${KEEP_AS_VENDOR.join(', ')}`);

  await query(
    `UPDATE npcs SET npc_type = 'unemployed', behaviour_graph = $1 WHERE npc_type = 'vendor' AND id != ALL($2)`,
    [JSON.stringify(UNEMPLOYED_GRAPH), KEEP_AS_VENDOR]
  );

  console.log(`\nUpdated ${rows.length} NPC(s) → unemployed.`);
  console.log('Restart the server to pick up the new graphs.');
  process.exit(0);
}

main().catch(err => { console.error(err.message); process.exit(1); });
