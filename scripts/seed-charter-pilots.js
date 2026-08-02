// One-shot: seed the three charter pilots (a new `charter_pilot` NPC personality).
// They cover a 24-hour day between them on staggered 8-hour shifts, each stationed
// at a different charter field. Run once, then reload the world:
//   node scripts/seed-charter-pilots.js   →   POST /api/world/reload (or restart)
//
// Idempotent: each pilot is skipped if already present.
import { query } from '../server/models/db.js';

const PILOTS = [
  { id: 'npc_charter_doyle',  name: 'Ratchet Doyle', field: 'zone_outskirts',        shift: 0,
    desc: 'A wiry charter pilot in an oil-stained flight jacket, with a scar where an ear used to be and the flat, far-off stare of someone who has spent too long above the clouds. He works the graveyard shift out of Coldwater Regional.' },
  { id: 'npc_charter_soto',   name: 'Magpie Soto',   field: 'zone_yard_marshalling', shift: 8,
    desc: 'A stocky, quick-handed pilot with a magpie\'s eye for anything shiny and loose, forever chewing a toothpick. She flies the daylight run out of the Marshalling Yard freight field and swears she\'s never lost a passenger. On purpose.' },
  { id: 'npc_charter_kessler', name: 'Old Kessler',  field: 'zone_dock_slip',        shift: 16,
    desc: 'A gaunt, grey old bird of a man who talks to his aircraft more than to people. He takes the evening shift off Smuggler\'s Slip, and he will fly you absolutely anywhere — he just won\'t ask why.' },
];

for (const p of PILOTS) {
  const exists = await query('SELECT id FROM npcs WHERE id=$1', [p.id]);
  if (exists.rows.length) { console.log(`SKIP  ${p.id}`); continue; }
  const z = await query("SELECT flags->>'airfield_id' af FROM zones WHERE id=$1 AND flags ? 'airfield_id'", [p.field]);
  if (!z.rows.length) { console.warn(`SKIP ${p.id}: field ${p.field} missing`); continue; }
  const flags = { personality: 'charter_pilot', charter_pilot: { field: p.field, shift_start: p.shift } };
  await query(
    `INSERT INTO npcs (id, name, description, zone_id, work_zone_id, home_zone, npc_type, flags, sex, hp, hp_max, chitchat)
     VALUES ($1,$2,$3,$4,$4,'zone_residential_lobby','npc',$5,'male',24,24,'[]')`,
    [p.id, p.name, p.desc, p.field, JSON.stringify(flags)]
  );
  console.log(`CREATED ${p.name} @ ${z.rows[0].af || p.field} (shift ${String(p.shift).padStart(2, '0')}00–${String((p.shift + 8) % 24).padStart(2, '0')}00).`);
}
console.log('\nCharter pilots seeded. Reload the world, then `charter` at a staffed field during that pilot\'s shift.');
process.exit(0);
