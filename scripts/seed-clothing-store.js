// One-shot script: seed clothing store zone, vendor NPC Elio Sanz, and the
// zone's hackable Phantom Vault.
// Run once: node scripts/seed-clothing-store.js
//
// Prerequisite: run seed_apt2_clothing.js first so the clothing items exist.
//
// After running:
//   - Zone zone_clothing_store is unplaced. Move it via dev panel.
//   - NPC npc_elio_sanz spawns there with the full clothing catalogue.
//   - Active shelf starts empty — hit "Restock Now" or wait for the 24 h tick.
//   - The Phantom Vault (furn_vendor_safe_elio) holds Elio's sale credits.
//     Hack it with `hack safe` (requires hacking skill, difficulty 5).

import { query } from '../server/models/db.js';

// ─── CLOTHING CATALOGUE ───────────────────────────────────────────────────────
// These items must already exist in the DB (from seed_apt2_clothing.js).

const CLOTHING_IDS = [
  'item_cobalt_scarf',
  'item_reaper_tshirt',
  'item_gold_chain',
  'item_onyx_malachite_bracelets',
  'item_cyber_track_pants',
  'item_cat_boxers',
  'item_finger_rings_set',
];

// ─── ZONE ────────────────────────────────────────────────────────────────────

const ZONE_ID = 'zone_clothing_store';
const NPC_ID  = 'npc_elio_sanz';
const SAFE_ID = 'furn_vendor_safe_elio';

const DIALOGUE_TREE = {
  root: {
    text: "Elio looks up from rehanging a track pant with the seriousness of someone correcting a sentence. 'You looking for something specific, or you want me to find it for you?'",
    options: [
      { label: "Show me what you have.", next: '__shop__' },
      { label: "What's the style here?", next: 'style' },
      { label: "How does the layering system work?", next: 'layering' },
      { label: "Just browsing.", next: 'end' },
    ],
  },
  style: {
    text: "'Signal Noise.' He says it like it's the only reasonable answer. 'Everything in here works in low light, in motion, or next to something it shouldn't be next to. No statement pieces. No occasion wear. Stock rotates. What's here today might not be here tomorrow.'",
    options: [
      { label: "I'll take a look.", next: '__shop__' },
      { label: "Makes sense.", next: 'root' },
    ],
  },
  layering: {
    text: "'Skin first, then base, then mid, then outer. Everything in here is tagged with the layer range it runs in. You put a jacket under a scarf, you look like you're moving furniture.' He gives you a look that suggests this is not a hypothetical.",
    options: [
      { label: "Got it.", next: 'root' },
      { label: "Show me something.", next: '__shop__' },
    ],
  },
  end: {
    text: "'Take your time.' He goes back to the rack, nudging a sleeve into alignment by three millimetres.",
    options: [],
  },
};

const CHITCHAT = [
  "Elio adjusts something on the rack that didn't need adjusting.",
  "'The gold chain goes with everything. That's not an opinion, it's physics.'",
  "He watches you look at the boxers without comment, which is its own comment.",
  "'Most of what I carry you won't see unless someone looks closely. That's the point.'",
  "'The scarf came from an estate sale. Previous owner had good taste.'",
  "Elio pulls a thread from a seam, examines it, discards it with the detachment of a surgeon.",
  "'Rings are underrated. Eight points of contact with the world. Make them count.'",
];

// ─── SEED ────────────────────────────────────────────────────────────────────

let created = 0, skipped = 0;

// 1. Verify clothing items exist and build catalogue with their current prices
const catalogue = [];
for (const id of CLOTHING_IDS) {
  const { rows } = await query('SELECT id, value FROM items WHERE id=$1', [id]);
  if (!rows.length) {
    console.log(`MISSING item ${id} — run seed_apt2_clothing.js first`);
    continue;
  }
  catalogue.push({ item_id: id, price: rows[0].value });
  console.log(`FOUND  item ${id} (₵${rows[0].value})`);
}

if (!catalogue.length) {
  console.error('No clothing items found. Run seed_apt2_clothing.js first.');
  process.exit(1);
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
      'Signal Noise',
      "A narrow shopfront wedged between a vape bar and a boarded-up pharmacy. The walls are raw concrete hung with items on reclaimed pipe rails. A strip of electroluminescent wire runs the perimeter at shoulder height, casting everything in a low blue-white glow that makes skin look like it's been printed. The floor is scuffed black rubber matting, the kind used in gyms and slaughterhouses. Sizes are not labelled.",
      JSON.stringify({ is_interior: true }),
    ]
  );
  console.log(`CREATE zone ${ZONE_ID}`);
  created++;
}

// 3. Create vendor NPC
const { rows: npcExists } = await query('SELECT id FROM npcs WHERE id=$1', [NPC_ID]);
if (npcExists.length) {
  console.log(`SKIP  npc ${NPC_ID}`);
  skipped++;
} else {
  await query(
    `INSERT INTO npcs (id,name,description,zone_id,home_zone,dialogue_tree,vendor_inventory,
       vendor_stock_size,vendor_restock_rate,wanders,flags,chitchat,hp,hp_max,sex)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,0,$9,$10,20,20,'male')`,
    [
      NPC_ID,
      'Elio Sanz',
      "Elio Sanz is compact and precise, with close-cropped dark hair and the kind of stillness that comes from spending most of your day deciding whether something is one millimetre off. He wears his own stock — track pants, a scarf, rings on most fingers — and makes it look like a decision rather than a habit.",
      ZONE_ID,
      JSON.stringify(DIALOGUE_TREE),
      JSON.stringify(catalogue),
      5,  // vendor_stock_size — smaller catalogue, smaller shelf
      1,  // vendor_restock_rate
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
console.log('Zone zone_clothing_store is unplaced — position it via the dev panel.');
console.log('Vendor shelf starts empty — use Restock Now in the NPC editor, or wait for the 24 h tick.');
process.exit(0);
