// One-shot content: flag the city checkpoint zone(s) for the smuggle loop (Phase 2).
//   Run once:  node scripts/add-smuggle-checkpoints.js
//   Restart / world-reload after so the zone cache picks up the new flag.
//
// The smuggle plugin's `smuggle:checkpoint` move gate fires on any zone with
// flags.checkpoint = true: carry raw drug material into it and a scanner runs a
// Deception check (fail = Manufacturing bust + bounced back). This just marks
// which zones are border posts. Add more ids to CHECKPOINTS to wall off more
// routes into the city from the wastes — the gate needs no code change.
//
// zone_civ_steps ("Civic Steps") is the clean chokepoint on The Axis artery —
// the municipal stair between the water/outskirts and the North City government
// district. It's the natural first border post between the lawless drop and town.
import { query } from '../server/models/db.js';

const CHECKPOINTS = ['zone_civ_steps'];

async function main() {
  const { rows: exist } = await query('SELECT id, name FROM zones WHERE id = ANY($1)', [CHECKPOINTS]);
  const found = new Set(exist.map(r => r.id));
  const missing = CHECKPOINTS.filter(id => !found.has(id));
  if (missing.length) console.warn(`⚠ not in DB (skipped): ${missing.join(', ')}`);

  if (found.size) {
    await query(
      `UPDATE zones SET flags = COALESCE(flags,'{}'::jsonb) || '{"checkpoint":true}'::jsonb
        WHERE id = ANY($1)`,
      [[...found]]);
    for (const r of exist) console.log(`  ✓ checkpoint: ${r.name} (${r.id})`);
  }
  console.log(`✓ ${found.size} checkpoint zone(s) flagged. Restart / reload the world so the flag goes live.`);
  process.exit(0);
}
main().catch((e) => { console.error('✗ add-smuggle-checkpoints failed:', e.message); process.exit(1); });
