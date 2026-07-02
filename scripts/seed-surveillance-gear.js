// One-shot script: seed SPECTER surveillance gear item definitions (Phase 1).
// Run once:            node scripts/seed-surveillance-gear.js
// Grant one of each:   node scripts/seed-surveillance-gear.js <playerId>
//
// These are the carriable devices consumed by `plant`. The item's `tags` carry the
// device contract the surveillance plugin reads on plant:
//   security_gear (flag), device_kind, device_tier, battery_max, wired,
//   hack_difficulty, concealment_base.
// Real acquisition (vendor + crafting) is Phase 5 — this seed just makes Phase 1
// testable. Requires a server restart for the surveillance plugin to be loaded.

import { randomUUID } from 'crypto';
import { query } from '../server/models/db.js';

const GEAR = [
  {
    id: 'item_sticky_cam',
    name: 'Sticky Cam',
    description: 'A thumb-sized adhesive camera the colour of dead concrete. Runs off an internal cell for days and squirts its feed to a paired deck.',
    value: 350, weight: 400, rarity: 'uncommon',
    tags: { security_gear: true, device_kind: 'sticky_cam', device_tier: 1,
            battery_max: 864, wired: false, hack_difficulty: 5, concealment_base: 4 },
  },
  {
    id: 'item_wired_cam',
    name: 'Tap Cam',
    description: 'A slim panel camera that splices straight into a room\'s power feed. Never needs charging — but dies the instant the grid does.',
    value: 260, weight: 500, rarity: 'common',
    tags: { security_gear: true, device_kind: 'sticky_cam', device_tier: 1,
            battery_max: 864, wired: true, hack_difficulty: 5, concealment_base: 3 },
  },
  {
    id: 'item_spy_drone',
    name: 'Recon Drone',
    description: 'A palm-sized quadrotor that folds into a matte-black wafer. Thirsty on power — hours, not days — but it can be flown into places you can\'t reach.',
    value: 1200, weight: 900, rarity: 'rare',
    tags: { security_gear: true, device_kind: 'drone', device_tier: 2,
            battery_max: 864, wired: false, hack_difficulty: 6, concealment_base: 6 },
  },
  {
    // Not plantable (no security_gear tag) — this is the monitor. `use deck` or
    // `hub` opens the Surveillance Hub while it's in your inventory.
    id: 'item_spy_deck',
    name: 'Surveillance Deck',
    description: 'A folding slate of scuffed matte glass. Unfold it and every camera you\'ve seeded blooms across the screen at once — a wall of little rooms you shouldn\'t be able to see.',
    value: 900, weight: 700, rarity: 'rare',
    tags: { spy_deck: true },
  },
];

for (const g of GEAR) {
  await query(
    `INSERT INTO items (id, name, description, type, weight, value, rarity, tags)
     VALUES ($1,$2,$3,'device',$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, description=EXCLUDED.description, weight=EXCLUDED.weight,
       value=EXCLUDED.value, rarity=EXCLUDED.rarity, tags=EXCLUDED.tags`,
    [g.id, g.name, g.description, g.weight, g.value, g.rarity, JSON.stringify(g.tags)]
  );
  console.log(`UPSERT item ${g.id}`);
}

const playerId = process.argv[2];
if (playerId) {
  const { rows } = await query('SELECT id FROM players WHERE id=$1', [playerId]);
  if (!rows.length) {
    console.error(`No player with id "${playerId}" — skipped granting gear.`);
  } else {
    for (const g of GEAR) {
      await query(
        'INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)',
        [randomUUID(), playerId, g.id]
      );
      console.log(`GRANT ${g.id} -> ${playerId}`);
    }
  }
}

console.log('Done. Restart the server so the surveillance plugin loads.');
process.exit(0);
