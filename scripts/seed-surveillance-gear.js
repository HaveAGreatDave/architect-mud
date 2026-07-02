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
    value: 350, weight: 400,
    tags: { security_gear: true, device_kind: 'sticky_cam', device_tier: 1,
            battery_max: 864, wired: false, hack_difficulty: 5, concealment_base: 4 },
  },
  {
    id: 'item_wired_cam',
    name: 'Tap Cam',
    description: 'A slim panel camera that splices straight into a room\'s power feed. Never needs charging — but dies the instant the grid does.',
    value: 260, weight: 500,
    tags: { security_gear: true, device_kind: 'sticky_cam', device_tier: 1,
            battery_max: 864, wired: true, hack_difficulty: 5, concealment_base: 3 },
  },
  {
    id: 'item_spy_drone',
    name: 'Recon Drone',
    description: 'A palm-sized quadrotor that folds into a matte-black wafer. Thirsty on power — hours, not days — but it can be flown into places you can\'t reach.',
    value: 1200, weight: 900,
    tags: { security_gear: true, device_kind: 'drone', device_tier: 2,
            battery_max: 864, wired: false, hack_difficulty: 6, concealment_base: 6 },
  },
  {
    id: 'item_motion_sensor',
    name: 'Motion Tripwire',
    description: 'A matchbox of black plastic with a single dark lens. No picture — it just whispers to your deck the moment something warm moves past.',
    value: 220, weight: 300,
    tags: { security_gear: true, device_kind: 'motion_sensor', device_tier: 1,
            battery_max: 576, wired: false, hack_difficulty: 4, concealment_base: 5 },
  },
  {
    id: 'item_audio_sensor',
    name: 'Audio Bug',
    description: 'A pinhead mic on a strip of gecko-tape. Deaf to nothing loud — a gunshot, a scream, breaking glass — and it snitches instantly.',
    value: 240, weight: 250,
    tags: { security_gear: true, device_kind: 'audio_sensor', device_tier: 1,
            battery_max: 576, wired: false, hack_difficulty: 4, concealment_base: 6 },
  },
  {
    id: 'item_relay_node',
    name: 'Relay Node',
    description: 'A ruggedized signal repeater. Powered up, it punches your feeds through interference — deploy one where somebody likes to run a jammer.',
    value: 600, weight: 900,
    tags: { security_gear: true, device_kind: 'relay', device_tier: 2,
            battery_max: 576, wired: false, hack_difficulty: 5, concealment_base: 3 },
  },
  {
    id: 'item_signal_jammer',
    name: 'Signal Jammer',
    description: 'A squat black puck bristling with stubby antennae. Plant it and every camera in the sector chokes on static. Hungry on power, and hard to hide.',
    value: 800, weight: 1100,
    tags: { security_gear: true, device_kind: 'jammer', device_tier: 2,
            battery_max: 288, wired: false, hack_difficulty: 6, concealment_base: 2 },
  },
  {
    id: 'item_feed_spoofer',
    name: 'Feed Spoofer',
    description: 'A sleek relay that whispers a clean, empty-room loop into nearby cameras. The owner watches nothing happen while you work.',
    value: 1400, weight: 700,
    tags: { security_gear: true, device_kind: 'spoofer', device_tier: 3,
            battery_max: 288, wired: false, hack_difficulty: 7, concealment_base: 4 },
  },
  {
    // Not plantable (no security_gear tag) — this is the monitor. `use deck` or
    // `hub` opens the Surveillance Hub while it's in your inventory.
    id: 'item_spy_deck',
    name: 'Surveillance Deck',
    description: 'A folding slate of scuffed matte glass. Unfold it and every camera you\'ve seeded blooms across the screen at once — a wall of little rooms you shouldn\'t be able to see.',
    value: 900, weight: 700,
    tags: { spy_deck: true },
  },
];

for (const g of GEAR) {
  await query(
    `INSERT INTO items (id, name, description, type, weight, value, tags)
     VALUES ($1,$2,$3,'device',$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, description=EXCLUDED.description, weight=EXCLUDED.weight,
       value=EXCLUDED.value, tags=EXCLUDED.tags`,
    [g.id, g.name, g.description, g.weight, g.value, JSON.stringify(g.tags)]
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
