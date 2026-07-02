// One-shot script: seed the SPECTER black-market surveillance vendor.
// Run once: node scripts/seed-surveillance-vendor.js
//
// Requires the gear item defs first: node scripts/seed-surveillance-gear.js
// (this vendor's catalogue references those item ids).
//
// After running:
//   - Zone zone_surveillance_market is UNPLACED. Position it via the dev panel.
//   - NPC npc_glitch fences all SPECTER gear. Talk to them, pick "Show me the rack."
//   - Active stock starts empty; it fills via the vendor restock tick (or hit
//     "Restock Now" in the NPC editor).

import { query } from '../server/models/db.js';

const ZONE_ID = 'zone_surveillance_market';
const NPC_ID = 'npc_glitch';

const CATALOGUE = [
  { item_id: 'item_sticky_cam',    price: 350 },
  { item_id: 'item_wired_cam',     price: 260 },
  { item_id: 'item_spy_drone',     price: 1200 },
  { item_id: 'item_signal_jammer', price: 800 },
  { item_id: 'item_feed_spoofer',  price: 1400 },
  { item_id: 'item_spy_deck',      price: 900 },
];

const DIALOGUE_TREE = {
  root: {
    text: "A figure in a hood laced with dead fibre-optic strands looks up. 'Glitch. I move eyes and ears. You buying, or just casing the place?'",
    options: [
      { label: "Show me the rack.", next: '__shop__' },
      { label: "What is this place?", next: 'what' },
      { label: "How do I use this stuff?", next: 'how' },
      { label: "Nothing. Later.", next: 'end' },
    ],
  },
  what: {
    text: "'Off-books optics. Sticky cams, relays, sensors, the loud toys. All salvaged, all deniable. You didn't get it here, and I never saw your face.'",
    options: [
      { label: "Show me the rack.", next: '__shop__' },
      { label: "How do I use this stuff?", next: 'how' },
    ],
  },
  how: {
    text: "'Plant it where nobody looks. Pull the feed on a deck — that's `hub`. Cams see, sensors ping, jammers blind, spoofers lie. Somebody find yours? Smash it or hijack it. It's a whole food chain, kid.'",
    options: [
      { label: "Show me the rack.", next: '__shop__' },
      { label: "Good to know.", next: 'root' },
    ],
  },
  end: {
    text: "'Watch your back. Somebody always is.'",
    options: [],
  },
};

const CHITCHAT = [
  "Glitch flips a dead datachip end over end across their knuckles.",
  "'Everybody's got something they don't want seen. That's my whole business model.'",
  "A bank of tiny monitors behind the counter shows six empty rooms, all slightly wrong.",
  "'Wired cams are cheaper, but cut the power and they're paperweights. You get what you pay for.'",
  "'Somebody hijacked my own street cam last week. Respect. Cost me a fortune to get it back.'",
];

let created = 0, skipped = 0;

// 1. Zone
const { rows: zoneExists } = await query('SELECT id FROM zones WHERE id=$1', [ZONE_ID]);
if (zoneExists.length) { console.log(`SKIP  zone ${ZONE_ID}`); skipped++; }
else {
  await query(
    `INSERT INTO zones (id,name,description,danger_rating,flags,exits)
     VALUES ($1,$2,$3,'caution',$4,'{}')`,
    [ZONE_ID, 'The Blindspot',
     "A shipping container welded to the underside of an overpass, curtained off with mylar. Every surface crawls with scavenged lenses and coiled cable. A wall of mismatched monitors flickers with feeds from rooms you can't place. It smells of hot solder and rain on concrete.",
     JSON.stringify({ is_interior: true })]
  );
  console.log(`CREATE zone ${ZONE_ID}`); created++;
}

// 2. Vendor NPC
const { rows: npcExists } = await query('SELECT id FROM npcs WHERE id=$1', [NPC_ID]);
if (npcExists.length) { console.log(`SKIP  npc ${NPC_ID}`); skipped++; }
else {
  await query(
    `INSERT INTO npcs (id,name,description,zone_id,home_zone,dialogue_tree,vendor_inventory,
       vendor_stock_size,vendor_restock_rate,wanders,flags,chitchat,hp,hp_max,sex)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,1,0,$8,$9,24,24,'other')`,
    [NPC_ID, 'Glitch',
     "Glitch is a wiry fence draped in a hoodie threaded with dead fibre-optics that catch the monitor glow. Their fingers never stop moving — flipping a chip, coiling cable, tapping a keyboard you can't see. Their eyes flick to every camera in the room before they land on you.",
     ZONE_ID,
     JSON.stringify(DIALOGUE_TREE),
     JSON.stringify(CATALOGUE),
     6,
     JSON.stringify({ personality: 'vendor' }),
     JSON.stringify(CHITCHAT)]
  );
  console.log(`CREATE npc ${NPC_ID}`); created++;
}

console.log(`Done. Created ${created}, skipped ${skipped}. Place zone_surveillance_market via the dev panel to make it reachable.`);
process.exit(0);
