// One-shot content seed for the jail duty roster + cell fixtures. Run once:
//   node scripts/create-jail-officers.js
// Idempotent — skips anything already present. After running, restart the server
// (or POST /world/reload) so the NPCs/furniture load into the world cache.
//
// Adds:
//   - two new detention officers (Pryce, Marlow) to join the pre-existing Kohl.
//     The jail plugin rotates the three across 8-hour shifts: whoever's on duty
//     stands in the Precinct 9 lobby and walks released prisoners out; the other
//     two wait in the bullpen. (Street cop Sergeant Vale is left untouched.)
//   - a toilet, sink, and cot in the holding cell, so the bodily (relief/hygiene)
//     and posture (sleep) systems work while you're doing time.
import { query } from '../server/models/db.js';

const LOBBY_ZONE = 'zone_mq_precinct_lobby';
const CELL_ZONE = 'zone_mq_precinct_holding';

// ── Duty officers ────────────────────────────────────────────────────────────
const OFFICERS = [
  {
    id: 'npc_precinct_officer_2',
    name: 'Detention Officer Pryce',
    description: 'Wiry and unhurried, Pryce runs the holding block like a night-shift librarian — quiet, exact, and utterly unbothered by whatever you did to get here. A ring of mag-keys hangs off one hip; a lukewarm coffee never leaves the other hand.',
    chitchat: ['Pryce thumbs through a charge sheet without much interest.', '"Booking\'s backed up. Everybody\'s in a hurry to be somewhere worse."'],
  },
  {
    id: 'npc_precinct_officer_3',
    name: 'Detention Officer Marlow',
    description: 'Broad, slow-blinking, and built like a vending machine, Marlow works the graveyard rotation. He\'s processed enough overnight guests that nothing surprises him and nobody argues twice. His baton has a name. He won\'t tell you what it is.',
    chitchat: ['Marlow cracks his knuckles one at a time, watching the cells.', '"Sleep it off. Doors open when the clock says so, not when you do."'],
  },
];

let created = 0, skipped = 0;

for (const o of OFFICERS) {
  const exists = await query('SELECT id FROM npcs WHERE id=$1', [o.id]);
  if (exists.rows.length) { console.log(`SKIP  ${o.id} (already exists)`); skipped++; continue; }
  await query(
    `INSERT INTO npcs (id, name, description, zone_id, home_zone, faction, wanders, hp, hp_max, sex, flags, chitchat)
     VALUES ($1,$2,$3,$4,$4,'SPECTER-PD',0,60,60,'male',$5,$6)`,
    [o.id, o.name, o.description, LOBBY_ZONE,
     JSON.stringify({ essential: true, police: true, personality: 'police' }),
     JSON.stringify(o.chitchat)]
  );
  console.log(`CREATED ${o.id} (${o.name})`);
  created++;
}

// Kohl already lives in the lobby; make sure he reads as police (so he witnesses
// crime in the precinct and sits in the roster cleanly) without losing essential.
await query(
  `UPDATE npcs SET home_zone=$1, flags = flags || '{"police":true}'::jsonb
     WHERE id='npc_precinct_guard'`,
  [LOBBY_ZONE]
).catch(() => {});
console.log('UPDATED npc_precinct_guard (Kohl → police, home=lobby)');

// ── Cell fixtures ─────────────────────────────────────────────────────────────
const FIXTURES = [
  {
    id: 'furn_cell_toilet', name: 'steel cell toilet', object_type: 'toilet',
    flags: {},
    description: 'A seatless steel toilet-and-basin combo bolted to the cinderblock, scuffed to a dull shine by a decade of reluctant use. No lid, no privacy, no dignity — just cold metal and a slow, resigned trickle.',
  },
  {
    id: 'furn_cell_sink', name: 'stainless cell sink', object_type: 'sink',
    flags: { water_source: true },
    description: 'A knuckle-sized stainless basin jutting from the wall above the toilet. One push-button tap coughs out a thin stream of cold water — enough to drink, or to scrub the worst of the night off your hands.',
  },
  {
    id: 'furn_cell_cot', name: 'bolted steel cot', object_type: 'furniture',
    flags: { interactions: ['sit', 'lie'] },
    description: 'A steel shelf welded to the wall, topped with a vinyl pad the thickness of a sympathy card. It is not comfortable. It is, technically, a place to lie down until the clock lets you out.',
  },
];

for (const f of FIXTURES) {
  const exists = await query('SELECT id FROM furniture WHERE id=$1', [f.id]);
  if (exists.rows.length) { console.log(`SKIP  ${f.id} (already exists)`); skipped++; continue; }
  await query(
    `INSERT INTO furniture (id, zone_id, name, description, object_type, flags)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [f.id, CELL_ZONE, f.name, f.description, f.object_type, JSON.stringify(f.flags)]
  );
  console.log(`CREATED ${f.id} (${f.name})`);
  created++;
}

console.log(`Done. Created ${created}, skipped ${skipped}. Restart the server or POST /world/reload.`);
process.exit(0);
