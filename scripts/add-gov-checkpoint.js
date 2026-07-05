// One-shot content: flag the government-quarter checkpoint (The Steps) + the enclave.
//   Preview:  node scripts/add-gov-checkpoint.js --dry
//   Apply:    node scripts/add-gov-checkpoint.js
//   Restart / world-reload after so the zone cache picks up the flags.
//
// The govgate plugin's move gate fires when you enter a `flags.gov_checkpoint` tile
// from a tile that ISN'T `flags.gov_enclave` — i.e. crossing INTO the NW enclave from
// outside. So we flag all 14 enclave tiles (gov_enclave) and the single surface gate,
// zone_up_vellum, as the checkpoint. The Under landing (gov_mezzanine ↓) is left
// unflagged on purpose — the covert bypass.
import { query } from '../server/models/db.js';

const ENCLAVE = [
  'zone_up_vellum',
  'zone_gov_ministry', 'zone_gov_assembly', 'zone_gov_prefect', 'zone_gov_registry',
  'zone_gov_cobalt', 'zone_gov_vantage', 'zone_gov_mezzanine', 'zone_gov_onyx',
  'zone_nc_halcyon', 'zone_nc_skyline', 'zone_nc_datum', 'zone_nc_sable', 'zone_nc_spindle',
];
const CHECKPOINT = 'zone_up_vellum';
const CHECKPOINT_LINE = ' A security checkpoint straddles The Steps here — a scanner arch and a pair of unimpressed guards vetting everyone who climbs up into the government quarter.';

async function main() {
  const DRY = process.argv.includes('--dry');
  const { rows } = await query('SELECT id, description FROM zones WHERE id = ANY($1)', [ENCLAVE]);
  const found = new Set(rows.map(r => r.id));
  const missing = ENCLAVE.filter(id => !found.has(id));
  if (missing.length) console.warn(`⚠ enclave tiles not in DB (skipped): ${missing.join(', ')}`);
  console.log(`enclave tiles present: ${found.size}/${ENCLAVE.length}`);

  if (DRY) { console.log(`(dry) would flag ${found.size} tiles gov_enclave + ${found.has(CHECKPOINT) ? CHECKPOINT : '(checkpoint MISSING!)'} gov_checkpoint`); process.exit(0); }

  await query(
    `UPDATE zones SET flags = COALESCE(flags,'{}'::jsonb) || '{"gov_enclave":true}'::jsonb WHERE id = ANY($1)`,
    [[...found]]);
  if (found.has(CHECKPOINT)) {
    const desc = rows.find(r => r.id === CHECKPOINT)?.description || '';
    const newDesc = /security checkpoint/.test(desc) ? desc : desc + CHECKPOINT_LINE;
    await query(`UPDATE zones SET flags = COALESCE(flags,'{}'::jsonb) || '{"gov_checkpoint":true}'::jsonb, description=$1 WHERE id=$2`, [newDesc, CHECKPOINT]);
    console.log(`  ✓ ${CHECKPOINT} flagged as the government checkpoint (The Steps)`);
  } else {
    console.error(`✗ checkpoint tile ${CHECKPOINT} not found — the gate has nowhere to fire!`);
    process.exit(1);
  }
  console.log(`✓ ${found.size} enclave tiles flagged. Restart / reload the world.`);
  process.exit(0);
}
main().catch((e) => { console.error('✗ add-gov-checkpoint failed:', e.message); process.exit(1); });
