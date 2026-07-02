// One-shot script: seed furniture store zone, vendor NPC Juno Kael, purchasable
// furniture item records, and the zone's hackable Phantom Vault.
// Run once: node scripts/seed-furniture-store.js
//
// After running:
//   - Zone zone_furniture_store is unplaced. Move it via dev panel.
//   - NPC npc_juno_kael spawns there with a full vendor catalogue.
//   - Active shelf starts empty — hit "Restock Now" in the NPC editor or wait
//     for the 24 h tick to populate it (vendor_restock_rate = 1 item/day by default).
//   - The Phantom Vault (furn_vendor_safe_juno) holds Juno's sale credits.
//     Hack it with `hack safe` (requires hacking skill, difficulty 5).

import { query } from '../server/models/db.js';

// ─── PURCHASABLE FURNITURE ITEMS ─────────────────────────────────────────────

const FURNITURE_ITEMS = [
  {
    id: 'item_furn_mag_lev_chair',
    name: 'Mag-Lev Chair',
    description: 'A glossy white chair with no legs, held half a metre off the floor by a repulsion field embedded in the base plate.',
    value: 2400, weight: 8000,
  },
  {
    id: 'item_furn_haptic_throne',
    name: 'Haptic Executive Throne',
    description: 'A massive contoured chair upholstered in self-healing polymer leather. Micro-actuators shift beneath you constantly, reading your weight distribution and adjusting lumbar support in real-time.',
    value: 4800, weight: 28000,
  },
  {
    id: 'item_furn_corpcore_bench',
    name: 'Corp-Issue Bench',
    description: 'Stamped aluminium, no back support, uncomfortable by design. A small pressure sensor on the seat surface logs duration of occupancy.',
    value: 180, weight: 12000,
  },
  {
    id: 'item_furn_diner_booth',
    name: 'Diner Booth',
    description: 'Vinyl bench seat and a laminate table in a faded checkerboard pattern. A design from 2019 preserved through sheer indifference.',
    value: 650, weight: 22000,
  },
  {
    id: 'item_furn_barstool_wreck',
    name: 'Wobbly Barstool',
    description: 'Three legs when it started life. Now two and a half, bridged by industrial epoxy. The seat rotates freely in both directions.',
    value: 60, weight: 3000,
  },
  {
    id: 'item_furn_pneumatic_stool',
    name: 'Pneumatic Lab Stool',
    description: 'A chrome-and-rubber height-adjustable stool, the kind found in clinical spaces from clinics to interrogation rooms.',
    value: 320, weight: 5000,
  },
  {
    id: 'item_furn_meditation_pod',
    name: 'Sensory Pod Seat',
    description: 'A curved half-shell of acoustic foam and matte black composite. Inside it is almost silent. The seat surface conforms to your body.',
    value: 890, weight: 9000,
  },
  {
    id: 'item_furn_neural_couch',
    name: 'Neural Interface Couch',
    description: 'Long enough to lie flat in, upholstered in smart-foam that tracks your body temperature. Three data ports run along the headrest.',
    value: 3200, weight: 35000,
  },
  {
    id: 'item_furn_busted_sofa',
    name: 'Busted Sofa',
    description: 'Cracked pleather in a brown that was probably beige originally. There is a spring that will find you.',
    value: 120, weight: 20000,
  },
  {
    id: 'item_furn_sleep_pod',
    name: 'Sleep Pod',
    description: 'A coffin-shaped enclosure of brushed titanium with a frosted acrylic lid, climate-controlled and REM-monitored.',
    value: 6500, weight: 60000,
  },
  {
    id: 'item_furn_mil_surplus_cot',
    name: 'Surplus Cot',
    description: 'Military-issue folding cot from a conflict that ended badly. Smells like three previous people.',
    value: 95, weight: 4000,
  },
  {
    id: 'item_furn_pipe_railing',
    name: 'Pipe Railing',
    description: 'A length of galvanised steel pipe for bolting along a wall at hip height. The welds are lumpy and oxidised. It holds.',
    value: 75, weight: 6000,
  },
  {
    id: 'item_furn_payphone_husk',
    name: 'Dead Payphone',
    description: 'A payphone booth stripped of everything useful. The coin slot is blocked with concrete. Good for decoration.',
    value: 40, weight: 18000,
  },
  {
    id: 'item_furn_counter_slab',
    name: 'Concrete Counter',
    description: 'A poured-concrete service counter, surface scarred with knife gouges and ring stains.',
    value: 780, weight: 80000,
  },
  {
    id: 'item_furn_nano_desk',
    name: 'Self-Organizing Desk',
    description: 'A broad desk surface with embedded touchpads and holographic emitters projecting a ghost workspace thirty centimetres above the surface.',
    value: 3600, weight: 18000,
  },
  {
    id: 'item_furn_wallscreen',
    name: 'Neon Slab TV',
    description: 'A paper-thin display that runs floor to ceiling, laminated directly to the wall surface. The image quality is immaculate.',
    value: 5200, weight: 4000,
  },
  {
    id: 'item_furn_crt_relic',
    name: 'Cathode Box TV',
    description: 'A 24-inch cathode-ray tube set from the 2010s. The picture is warm and slightly wrong in a way that feels human.',
    value: 280, weight: 22000,
  },
  {
    id: 'item_furn_holo_projector',
    name: 'Ghost Screen TV',
    description: 'A hovering display unit kept aloft by a low-power gravity field. The projection leans three degrees left. The patch bricked the others.',
    value: 4100, weight: 3000,
  },
  {
    id: 'item_furn_ruggedized_monitor',
    name: 'Chrome Feed TV',
    description: 'A military-spec portable display, matte black, bolted to a repurposed equipment rack. The screen is scratched but perfectly legible.',
    value: 1600, weight: 9000,
  },
];

// ─── ZONE ────────────────────────────────────────────────────────────────────

const ZONE_ID = 'zone_furniture_store';
const NPC_ID  = 'npc_juno_kael';
const SAFE_ID = 'furn_vendor_safe_juno';

const DIALOGUE_TREE = {
  root: {
    text: "Juno looks up from a clipboard of handwritten inventory tallies. 'Browse or buy — I don't care which, as long as you don't sit on everything without committing. What can I do for you?'",
    options: [
      { label: "I'm looking for furniture.", next: 'looking' },
      { label: "What is this place?", next: 'what_is_this' },
      { label: "How does pricing work?", next: 'pricing' },
      { label: "Browse your wares.", next: '__shop__' },
      { label: "Nothing, just looking.", next: 'end' },
    ],
  },
  looking: {
    text: "'Good. Everything in here is functional, everything has a story, and most of the stories are better than the things in the showroom right now.' She gestures at the vignettes behind her. 'Stock rotates. If you don't see what you want today, come back tomorrow.'",
    options: [
      { label: "Show me what you've got.", next: '__shop__' },
      { label: "I'll look around.", next: 'end' },
    ],
  },
  what_is_this: {
    text: "'Dead Space Interiors. I took the name from the lease — the building code still says DEAD SPACE on the fire certificate. Seemed honest.' She taps the clipboard. 'I source from estate sales, corporate liquidations, lab clearances. If something's in here it works or it's interesting. Usually both.'",
    options: [
      { label: "Sounds like my kind of place.", next: 'root' },
      { label: "Show me what you've got.", next: '__shop__' },
    ],
  },
  pricing: {
    text: "'Prices are what they are. The mag-lev stuff costs what it costs because the components aren't made anymore and the patent holders are suing each other into dust. The surplus cots are cheap because they're surplus. I don't negotiate down — I might negotiate trade.'",
    options: [
      { label: "Fair enough.", next: 'root' },
      { label: "Let me see the inventory.", next: '__shop__' },
    ],
  },
  end: {
    text: "'Take your time.' She goes back to her clipboard.",
    options: [],
  },
};

const CHITCHAT = [
  "Juno makes a note on her clipboard without looking up.",
  "'Half of this came from a corporate office liquidated in forty-eight hours. Surprising what people leave behind when security cuts their badge.'",
  "She straightens a price tag that didn't need straightening.",
  "'The sleep pod's the best thing in here. I tested it myself. Didn't want to get up. That's a good sign.'",
  "'Stock rotates every day. Yesterday I had three mag-lev chairs. Now I have one.'",
  "'I'm not a decorator. I'm a vendor. If you want to know if it'll hold your weight, I can help.'",
];

// ─── SEED ────────────────────────────────────────────────────────────────────

let created = 0, skipped = 0;

// 1. Upsert furniture item records
for (const item of FURNITURE_ITEMS) {
  await query(
    `INSERT INTO items (id, name, description, type, weight, value, tags)
     VALUES ($1,$2,$3,'furniture',$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, description=EXCLUDED.description, weight=EXCLUDED.weight,
       value=EXCLUDED.value`,
    [item.id, item.name, item.description, item.weight, item.value, JSON.stringify({ description: item.description })]
  );
  console.log(`UPSERT item ${item.id}`);
}

// 2. Create zone
const { rows: zoneExists } = await query('SELECT id FROM zones WHERE id=$1', [ZONE_ID]);
if (zoneExists.length) {
  console.log(`SKIP  zone ${ZONE_ID}`);
  skipped++;
} else {
  await query(
    `INSERT INTO zones (id,name,description,danger_rating,flags,exits)
     VALUES ($1,$2,$3,'safe',$4,'{}')`,
    [
      ZONE_ID,
      'Dead Space Interiors',
      "A decommissioned industrial unit repurposed as a furniture showroom. Exposed concrete, neon tube lighting that flickers on a deliberate schedule. The pieces are arranged in vignettes separated by strips of blue painter's tape on the floor. Price tags are handwritten on recycled cardboard. The air smells of outgassing polymer and burnt coffee from a percolator no one will admit to owning.",
      JSON.stringify({ is_interior: true }),
    ]
  );
  console.log(`CREATE zone ${ZONE_ID}`);
  created++;
}

// 3. Create vendor NPC (full catalogue, no initial stock — restock tick fills it)
const { rows: npcExists } = await query('SELECT id FROM npcs WHERE id=$1', [NPC_ID]);
if (npcExists.length) {
  console.log(`SKIP  npc ${NPC_ID}`);
  skipped++;
} else {
  const catalogue = FURNITURE_ITEMS.map(i => ({ item_id: i.id, price: i.value }));
  await query(
    `INSERT INTO npcs (id,name,description,zone_id,home_zone,dialogue_tree,vendor_inventory,
       vendor_stock_size,vendor_restock_rate,wanders,flags,chitchat,hp,hp_max,sex)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,0,$9,$10,20,20,'female')`,
    [
      NPC_ID,
      'Juno Kael',
      "Juno Kael is tall and angular, her hair dye growing out in a gradient from platinum to black root. She wears a faded Dead Space Interiors polo shirt tucked into cargo trousers. She tracks you with the patient, evaluating attention of someone who has spent a lot of time waiting for browsers to become buyers.",
      ZONE_ID,
      JSON.stringify(DIALOGUE_TREE),
      JSON.stringify(catalogue),
      10,  // vendor_stock_size
      1,   // vendor_restock_rate
      JSON.stringify({ personality: 'vendor' }),
      JSON.stringify(CHITCHAT),
    ]
  );
  console.log(`CREATE npc ${NPC_ID}`);
  created++;
}

// 4. Create Phantom Vault (hackable vendor safe)
const { rows: safeExists } = await query('SELECT id FROM furniture WHERE id=$1', [SAFE_ID]);
if (safeExists.length) {
  console.log(`SKIP  furniture ${SAFE_ID}`);
  skipped++;
} else {
  await query(
    `INSERT INTO furniture (id,zone_id,name,description,object_type,flags)
     VALUES ($1,$2,$3,$4,'fixture',$5)`,
    [
      SAFE_ID,
      ZONE_ID,
      'Phantom Vault',
      "A matte-black security enclosure about the size of a microwave oven, bolted directly into the structural concrete behind the counter. The door has no visible seam, no keyway, no biometric reader. The entire face is a single panel of electrochromic glass that cycles between mirror, opaque, and — briefly — translucent, though there is nothing visibly inside when it clears. A holographic lock interface shimmers above the surface: a rotating key rendered in the 8–14nm band, invisible to the naked eye. The frequency shifts every ninety seconds. Etched in the concrete beside it in small, precise letters: PROPERTY OF VENDOR. MONITORED.",
      JSON.stringify({ vendor_safe: true, vendor_npc_id: NPC_ID, hack_difficulty: 5 }),
    ]
  );
  console.log(`CREATE furniture ${SAFE_ID}`);
  created++;
}

console.log(`\nDone. Created: ${created}, Skipped: ${skipped}`);
console.log('Zone zone_furniture_store is unplaced — position it via the dev panel.');
console.log('Vendor shelf starts empty — use Restock Now in the NPC editor, or wait for the 24 h tick.');
process.exit(0);
