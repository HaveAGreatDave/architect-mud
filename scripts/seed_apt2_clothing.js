import { query } from '../server/models/db.js';

const items = [
  {
    id: 'item_cobalt_scarf',
    name: 'cobalt alpaca scarf',
    weight: 200, value: 180,
    tags: {
      description: 'A long cobalt-blue alpaca scarf that drapes almost to the knees, its thick, soft weave standing out against darker outfits. The luxurious fibers soften an otherwise hardened look, and the frayed ends sway with every step.',
      slot: 'accessory', armor: 1, insulation: 4, bulkiness: 2,
      allowed_layer_range: { min: 3, max: 5 }, gets_wet: true,
    },
  },
  {
    id: 'item_reaper_tshirt',
    name: 'grim reaper tee',
    weight: 300, value: 60,
    tags: {
      description: 'A fitted black T-shirt with a large grim reaper graphic dominating the back, rendered in faded monochrome with distressed details that give it the look of a well-worn band tee. From the front it is simple and understated, revealing its striking artwork only from behind.',
      slot: 'torso', armor: 1, insulation: 1, bulkiness: 1,
      allowed_layer_range: { min: 2, max: 3 }, gets_wet: true,
    },
  },
  {
    id: 'item_gold_chain',
    name: 'gold chain',
    weight: 150, value: 400,
    tags: {
      description: 'A medium-weight gold chain that rests around the neck, catching the glow of neon lights with every movement. Its warm metallic sheen adds a subtle touch of luxury to an otherwise dark streetwear ensemble.',
      slot: 'accessory', armor: 0, insulation: 0, bulkiness: 1,
      allowed_layer_range: { min: 2, max: 5 },
    },
  },
  {
    id: 'item_onyx_malachite_bracelets',
    name: 'onyx and malachite bracelets',
    weight: 180, value: 220,
    tags: {
      description: 'Several bracelets of polished black onyx and richly banded malachite beads wrapped around one wrist. The deep black stones contrast sharply with the swirling emerald-green patterns of the malachite, creating a rugged, eye-catching combination that blends natural materials with a futuristic aesthetic.',
      slot: 'accessory', armor: 0, insulation: 0, bulkiness: 1,
      allowed_layer_range: { min: 2, max: 4 },
    },
  },
  {
    id: 'item_cyber_track_pants',
    name: 'cyberpunk track pants',
    weight: 600, value: 130,
    tags: {
      description: 'Black athletic track pants with bold vertical Japanese lettering running down one leg in crisp white, accented by subtle reflective piping. The relaxed fit and tapered ankles give them a sleek cyberpunk streetwear silhouette.',
      slot: 'legs', armor: 2, insulation: 2, bulkiness: 2,
      allowed_layer_range: { min: 2, max: 4 }, gets_wet: true,
    },
  },
  {
    id: 'item_cat_boxers',
    name: 'cat-print boxer briefs',
    weight: 120, value: 25,
    tags: {
      description: 'Black boxer briefs patterned with playful cats in contrasting colors, hidden beneath outer layers except for the occasional glimpse of the waistband.',
      slot: 'legs', armor: 0, insulation: 1, bulkiness: 1,
      allowed_layer_range: { min: 1, max: 2 },
    },
  },
  {
    id: 'item_finger_rings_set',
    name: 'set of finger rings',
    weight: 120, value: 350,
    tags: {
      description: 'Every finger bears a distinctive ring, forming a complete collection of symbolic jewelry: a colorful candy skull ring with intricate enamel detailing; a Tree of Life ring with engraved roots and branches; a bold eagle ring with outstretched wings; a wolf ring featuring a snarling profile; a regal lion-head ring with a sculpted mane; and a black-and-gold signet ring displaying a winged skull emblem, its gold design standing out sharply against the dark face.',
      slot: 'hands', armor: 1, insulation: 0, bulkiness: 1,
      allowed_layer_range: { min: 2, max: 4 },
    },
  },
];

for (const item of items) {
  await query(
    `INSERT INTO items (id, name, weight, value, tags)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, weight=EXCLUDED.weight, value=EXCLUDED.value,
       tags=EXCLUDED.tags`,
    [item.id, item.name, item.weight, item.value, JSON.stringify(item.tags)]
  );
  console.log('upserted', item.id);
}

for (const item of items) {
  const id = `inv_apt2_seed_${item.id}`;
  await query(
    `INSERT INTO player_inventory (id, player_id, item_id, quantity)
     VALUES ($1, '_ground_zone_apt_2', $2, 1)
     ON CONFLICT (id) DO NOTHING`,
    [id, item.id]
  );
  console.log('placed', item.id, '→ zone_apt_2');
}

console.log('done');
process.exit(0);
