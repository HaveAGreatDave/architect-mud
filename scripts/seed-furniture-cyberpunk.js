// One-shot script: seed a variety of cyberpunk/dated furniture plus 4 broadcast TVs.
// Run once: node scripts/seed-furniture-cyberpunk.js
// All pieces default to zone_start; move them via the dev panel Furniture editor afterward.
//
// TVs need a channel assigned in-game: stand in the zone and run `tune <channel number>`.

import { query } from '../server/models/db.js';

const DEFAULT_ZONE = 'zone_start';

const FURNITURE = [

  // ─── CHAIRS & SEATING (sit) ─────────────────────────────────────────────

  {
    id: 'furn_mag_levitation_chair',
    name: 'Mag-Lev Chair',
    description: 'A glossy white chair with no legs, held half a metre off the floor by a repulsion field embedded in the base plate. The field hums at a frequency just below hearing. Sitting down feels like being caught by something that doesn\'t want you.',
    object_type: 'furniture',
    flags: { interactions: ['sit'] },
  },
  {
    id: 'furn_haptic_throne',
    name: 'Haptic Executive Throne',
    description: 'A massive contoured chair upholstered in self-healing polymer leather. Dozens of micro-actuators shift beneath you constantly, reading your weight distribution and adjusting lumbar support in real-time. A small biometric readout on the armrest displays your stress index. It is currently high.',
    object_type: 'furniture',
    flags: { interactions: ['sit'] },
  },
  {
    id: 'furn_corpcore_bench',
    name: 'Corp-Issue Bench',
    description: 'Stamped aluminium, no back support, uncomfortable by design. A small pressure sensor on the seat surface logs duration of occupancy. The corp logo has been scratched off, but you can still see the outline.',
    object_type: 'furniture',
    flags: { interactions: ['sit'] },
  },
  {
    id: 'furn_diner_booth',
    name: 'Diner Booth',
    description: 'Vinyl bench seat and a laminate table in a faded checkerboard pattern — a design from 2019 preserved through sheer indifference. The menu has been pasted over twice. The new one is a QR code that goes to a 404. Somebody has carved STILL HERE into the table surface.',
    object_type: 'furniture',
    flags: { interactions: ['sit'] },
  },
  {
    id: 'furn_barstool_wreck',
    name: 'Wobbly Barstool',
    description: 'Three legs when it started life. Now two and a half, with a wad of industrial epoxy bridging the gap. The seat rotates freely in both directions. If you sit still enough, it stops trying to face away from the bar.',
    object_type: 'furniture',
    flags: { interactions: ['sit'] },
  },
  {
    id: 'furn_pneumatic_stool',
    name: 'Pneumatic Lab Stool',
    description: 'A chrome-and-rubber height-adjustable stool, the kind found in every clinical space from clinics to interrogation rooms. The height lever works. The swivel lock does not.',
    object_type: 'furniture',
    flags: { interactions: ['sit'] },
  },
  {
    id: 'furn_meditation_pod_seat',
    name: 'Sensory Pod Seat',
    description: 'A curved half-shell of acoustic foam and matte black composite. Inside, it is almost silent. The seat surface conforms to your body after a few seconds. There is a faint residual smell of someone else\'s anxiety.',
    object_type: 'furniture',
    flags: { interactions: ['sit'] },
  },

  // ─── BEDS & COUCHES (lie / sit+lie) ─────────────────────────────────────

  {
    id: 'furn_neural_couch',
    name: 'Neural Interface Couch',
    description: 'Long enough to lie flat in, upholstered in smart-foam that tracks your body temperature. Three data ports run along the headrest, each capped with a rubber dust cover. The foam has a permanent impression from whoever used it before you. It fits badly.',
    object_type: 'furniture',
    flags: { interactions: ['sit', 'lie'] },
  },
  {
    id: 'furn_busted_sofa',
    name: 'Busted Sofa',
    description: 'Cracked pleather in a brown that was probably beige originally. One cushion has been flipped because of a stain that transferred from the other side anyway. There is a spring that will find you. You can sit on it or lie across it. Both options are a form of punishment.',
    object_type: 'furniture',
    flags: { interactions: ['sit', 'lie'] },
  },
  {
    id: 'furn_sleep_pod',
    name: 'Sleep Pod',
    description: 'A coffin-shaped enclosure of brushed titanium with a frosted acrylic lid, climate-controlled and REM-monitored. Lying down triggers the auto-seal sequence. A small orange light pulses on the exterior: OCCUPIED / OCCUPIED / OCCUPIED.',
    object_type: 'furniture',
    flags: { interactions: ['lie'] },
  },
  {
    id: 'furn_mil_surplus_cot',
    name: 'Surplus Cot',
    description: 'Military-issue folding cot from a conflict that ended badly. The canvas is stained in a way that\'s best not interrogated. It holds your weight, barely, with a sound like someone clearing their throat every time you shift. Smells like three previous people.',
    object_type: 'furniture',
    flags: { interactions: ['lie'] },
  },

  // ─── LEANABLES (lean) ────────────────────────────────────────────────────

  {
    id: 'furn_pipe_railing',
    name: 'Pipe Railing',
    description: 'A length of galvanised steel pipe bolted along the wall at hip height. The welds are lumpy and oxidised. It holds, though you\'d rather not test how hard. Someone has zip-tied a dozen old plastic bags to it, deflated and bleached by time.',
    object_type: 'fixture',
    flags: { interactions: ['lean'] },
  },
  {
    id: 'furn_payphone_husk',
    name: 'Dead Payphone',
    description: 'A payphone booth stripped of everything useful. The handset is fused to the cradle by a combination of heat and bad luck. The coin slot is blocked with concrete. The glass is scratched to opacity on one side, which makes it good for exactly one thing: leaning against while you wait for something that isn\'t coming.',
    object_type: 'decoration',
    flags: { interactions: ['lean'] },
  },
  {
    id: 'furn_counter_slab',
    name: 'Concrete Counter',
    description: 'A poured-concrete service counter, surface scarred with knife gouges and ring stains. Someone spraypainted NO CREDIT in red across the front, and someone else painted over it in beige, which has chipped enough to make the letters readable again. Sturdy enough to lean on forever.',
    object_type: 'furniture',
    flags: { interactions: ['lean'] },
  },
  {
    id: 'furn_nano_desk',
    name: 'Self-Organizing Desk',
    description: 'A broad desk surface studded with embedded touchpads and low-profile holographic emitters that project a ghost of a workspace about thirty centimetres above the surface. The spatial mapping is outdated — the virtual keyboard sits three centimetres to the left of where your hands naturally fall. Post-its have been affixed at the border where physical and projected meet.',
    object_type: 'furniture',
    flags: { interactions: ['lean'] },
  },

  // ─── TELEVISIONS (broadcast devices) ────────────────────────────────────

  {
    id: 'furn_wallscreen_broadcast',
    name: 'DataVision TV',
    description: 'A paper-thin display that runs floor to ceiling, laminated directly to the wall surface. The image quality is immaculate — every face is in pore-level detail. When nothing is playing, it shows a slow drift of channel-art that costs more to licence than the rent on the room.',
    object_type: 'appliance',
    flags: {
      tv: true,
      broadcast_receiver: true,
      broadcast_device_type: 'tv',

      interactions: ['lean'],
    },
  },
  {
    id: 'furn_crt_relic',
    name: 'Vidicron TV',
    description: 'A 24-inch cathode-ray tube set from the 2010s, propped on a milk crate at a height that requires you to look up at a slight, neck-wrecking angle. The channel dial is missing; someone has jammed a pair of needle-nose pliers into the shaft as a substitute. The scan lines are visible in strong light. The picture is warm and slightly wrong in a way that feels human.',
    object_type: 'appliance',
    flags: {
      tv: true,
      broadcast_receiver: true,
      broadcast_device_type: 'tv',

    },
  },
  {
    id: 'furn_holo_projector_unit',
    name: 'Phantex TV',
    description: 'A hovering display unit kept aloft by a low-power gravity field. The projection is crisp and vivid but the alignment is slightly off — everything leans three degrees to the left. The manufacturer issued a patch. The patch bricked three thousand units. This is one of the ones that survived the patch by never connecting.',
    object_type: 'appliance',
    flags: {
      tv: true,
      broadcast_receiver: true,
      broadcast_device_type: 'tv',

    },
  },
  {
    id: 'furn_ruggedized_monitor',
    name: 'Syntron TV',
    description: 'A military-spec portable display, matte black, bolted to a repurposed equipment rack with a cable tie. The screen is scratched but perfectly legible. A ring of rubber bumper surrounds the casing. There are three bullet holes in the rack below it, none in the screen, which says something about the priorities of whoever used this last.',
    object_type: 'appliance',
    flags: {
      tv: true,
      broadcast_receiver: true,
      broadcast_device_type: 'tv',

    },
  },
];

// ─── PURCHASABLE ITEM RECORDS FOR TVs ────────────────────────────────────────
// These mirror the furniture entries above but live in the items table so Juno
// Kael's vendor can stock them. value = base store price in credits.

const TV_ITEMS = [
  {
    id: 'item_furn_datavision_tv',
    name: 'DataVision TV',
    description: 'A paper-thin floor-to-ceiling display laminated directly to wall surface. Immaculate image quality. When nothing is playing it drifts channel-art that costs more to licence than the room.',
    value: 3800,
    weight: 14000,
    rarity: 'uncommon',
  },
  {
    id: 'item_furn_vidicron_tv',
    name: 'Vidicron TV',
    description: 'A 24-inch cathode-ray tube set propped on a milk crate. Channel dial missing; previous owner used needle-nose pliers. Scan lines visible in strong light. Picture is warm and slightly wrong in a way that feels human.',
    value: 220,
    weight: 18000,
    rarity: 'common',
  },
  {
    id: 'item_furn_phantex_tv',
    name: 'Phantex TV',
    description: 'A gravity-field display unit. Crisp and vivid but three degrees off-true. Never connected to the patch server. One of three thousand that survived the bricking.',
    value: 8500,
    weight: 6000,
    rarity: 'rare',
  },
  {
    id: 'item_furn_syntron_tv',
    name: 'Syntron TV',
    description: 'Military-spec display in matte black with rubber bumper surround. Screen scratched but perfectly legible. Rack has three bullet holes; the screen has none.',
    value: 2100,
    weight: 11000,
    rarity: 'uncommon',
  },
];

let created = 0;
let skipped = 0;

for (const f of FURNITURE) {
  const { rows: existing } = await query('SELECT id FROM furniture WHERE id=$1', [f.id]);
  if (existing.length) {
    console.log(`SKIP  ${f.id}`);
    skipped++;
    continue;
  }
  await query(
    `INSERT INTO furniture (id, zone_id, name, description, object_type, flags)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [f.id, DEFAULT_ZONE, f.name, f.description, f.object_type, JSON.stringify(f.flags)]
  );
  console.log(`CREATE ${f.id}`);
  created++;
}

// Insert TV item records (purchasable via vendor)
let itemsCreated = 0;
let itemsSkipped = 0;
for (const item of TV_ITEMS) {
  const { rows: existing } = await query('SELECT id FROM items WHERE id=$1', [item.id]);
  if (existing.length) {
    console.log(`SKIP  item ${item.id}`);
    itemsSkipped++;
    continue;
  }
  await query(
    `INSERT INTO items (id, name, description, type, weight, value, rarity, tags)
     VALUES ($1, $2, $3, 'furniture', $4, $5, $6, $7)`,
    [item.id, item.name, item.description, item.weight, item.value, item.rarity,
     JSON.stringify({ description: item.description })]
  );
  console.log(`CREATE item ${item.id}`);
  itemsCreated++;
}

console.log(`\nDone.`);
console.log(`Furniture — Created: ${created}, Skipped: ${skipped}`);
console.log(`TV items  — Created: ${itemsCreated}, Skipped: ${itemsSkipped}`);
console.log(`All pieces placed in zone "${DEFAULT_ZONE}". Move them via the dev panel Furniture editor.`);
console.log('TVs: stand in their zone and run `tune <channel number>` to assign a broadcast channel.');
process.exit(0);
