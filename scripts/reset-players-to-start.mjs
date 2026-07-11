// One-shot data transformation (prod): reset every player's current_zone to
// zone_start so existing accounts stranded in the old city core re-enter through
// the clone facility -> district. Dry-run by default; pass --apply to write.
// Backs up the before-state to a timestamped JSON before any mutation.
import { query } from '../server/models/db.js';
import { writeFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const START = 'zone_start';

const { rows: before } = await query(
  `SELECT id, handle, current_zone FROM players ORDER BY current_zone`);
console.log(`players total: ${before.length}`);

const dist = {};
for (const p of before) dist[p.current_zone] = (dist[p.current_zone] || 0) + 1;
console.log('current_zone distribution (top 15):');
Object.entries(dist).sort((a,b)=>b[1]-a[1]).slice(0,15)
  .forEach(([z,n]) => console.log(`  ${n.toString().padStart(4)}  ${z}`));

const already = dist[START] || 0;
console.log(`already at ${START}: ${already} | would move: ${before.length - already}`);

// verify target exists
const { rows: z } = await query(`SELECT id,name FROM zones WHERE id=$1`, [START]);
console.log(`target ${START}: ${z.length ? z[0].name : 'MISSING (abort!)'}`);
if (!z.length) process.exit(1);

const stamp = process.argv.find(a=>a.startsWith('--stamp='))?.split('=')[1] || 'manual';
const backupPath = `scripts/_reset-backup-${stamp}.json`;
writeFileSync(backupPath, JSON.stringify(before, null, 2));
console.log(`backup written: ${backupPath} (${before.length} rows)`);

if (!APPLY) { console.log('\nDRY RUN — no writes. Re-run with --apply to execute.'); process.exit(0); }

const res = await query(`UPDATE players SET current_zone=$1 WHERE current_zone<>$1`, [START]);
console.log(`\nAPPLIED: ${res.rowCount} players moved to ${START}.`);
process.exit(0);
