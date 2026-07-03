// One-shot script: seed the flashlight and battery item records.
// Run once: node scripts/seed-flashlight.js
//
// After running:
//   - item_flashlight and item_battery exist as item templates (nowhere placed).
//   - Give one to a player from the dev panel (Players → give item), add them to a
//     vendor catalogue, or drop them into a loot/scavenging table to make them
//     obtainable in-world.
//   - In game: `light flashlight` to switch on, `unlight` to save the cell,
//     `reload flashlight` to swap in a fresh battery. A lit flashlight makes dark
//     rooms readable; the cell lasts ~2 hours of continuous use.

import { query } from '../server/models/db.js';

const ITEMS = [
  {
    id: 'item_flashlight',
    name: 'flashlight',
    weight: 400,
    value: 45,
    tags: {
      description: 'A rugged rubber-armoured handheld flashlight. Throws a hard white cone of light. Runs on a single high-density cell — LIGHT it to switch on, UNLIGHT to save the charge, RELOAD it with a fresh battery when it dies.',
      flashlight: true,
      unique: true,
      misc: true,
    },
  },
  {
    id: 'item_battery',
    name: 'battery',
    weight: 80,
    value: 10,
    tags: {
      description: 'A stubby high-density power cell, warm to the touch. Snap it into a flashlight to bring it back to a full charge.',
      battery: true,
      misc: true,
    },
  },
];

let done = 0;
for (const item of ITEMS) {
  await query(
    `INSERT INTO items (id, name, weight, value, tags)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, weight=EXCLUDED.weight, value=EXCLUDED.value, tags=EXCLUDED.tags`,
    [item.id, item.name, item.weight, item.value, JSON.stringify(item.tags)]);
  console.log(`UPSERT item ${item.id}`);
  done++;
}

console.log(`\nDone. ${done} item(s) seeded.`);
process.exit(0);
