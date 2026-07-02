-- Seed clothing items for zone_apt_2
-- Run once against the database

INSERT INTO items (id, name, weight, value, tags) VALUES

('item_cobalt_scarf', 'cobalt alpaca scarf', 200, 180, '{
  "description": "A long cobalt-blue alpaca scarf that drapes almost to the knees, its thick, soft weave standing out against darker outfits. The luxurious fibers soften an otherwise hardened look, and the frayed ends sway with every step.",
  "slot": "accessory",
  "armor": 1,
  "insulation": 4,
  "bulkiness": 2,
  "allowed_layer_range": {"min": 3, "max": 5},
  "gets_wet": true
}'::jsonb),

('item_reaper_tshirt', 'grim reaper tee', 300, 60, '{
  "description": "A fitted black T-shirt with a large grim reaper graphic dominating the back, rendered in faded monochrome with distressed details that give it the look of a well-worn band tee. From the front it is simple and understated, revealing its striking artwork only from behind.",
  "slot": "torso",
  "armor": 1,
  "insulation": 1,
  "bulkiness": 1,
  "allowed_layer_range": {"min": 2, "max": 3},
  "gets_wet": true
}'::jsonb),

('item_gold_chain', 'gold chain', 150, 400, '{
  "description": "A medium-weight gold chain that rests around the neck, catching the glow of neon lights with every movement. Its warm metallic sheen adds a subtle touch of luxury to an otherwise dark streetwear ensemble.",
  "slot": "accessory",
  "armor": 0,
  "insulation": 0,
  "bulkiness": 1,
  "allowed_layer_range": {"min": 2, "max": 5}
}'::jsonb),

('item_onyx_malachite_bracelets', 'onyx and malachite bracelets', 180, 220, '{
  "description": "Several bracelets of polished black onyx and richly banded malachite beads wrapped around one wrist. The deep black stones contrast sharply with the swirling emerald-green patterns of the malachite, creating a rugged, eye-catching combination that blends natural materials with a futuristic aesthetic.",
  "slot": "accessory",
  "armor": 0,
  "insulation": 0,
  "bulkiness": 1,
  "allowed_layer_range": {"min": 2, "max": 4}
}'::jsonb),

('item_cyber_track_pants', 'cyberpunk track pants', 600, 130, '{
  "description": "Black athletic track pants with bold vertical Japanese lettering running down one leg in crisp white, accented by subtle reflective piping. The relaxed fit and tapered ankles give them a sleek cyberpunk streetwear silhouette.",
  "slot": "legs",
  "armor": 2,
  "insulation": 2,
  "bulkiness": 2,
  "allowed_layer_range": {"min": 2, "max": 4},
  "gets_wet": true
}'::jsonb),

('item_cat_boxers', 'cat-print boxer briefs', 120, 25, '{
  "description": "Black boxer briefs patterned with playful cats in contrasting colors, hidden beneath outer layers except for the occasional glimpse of the waistband.",
  "slot": "legs",
  "armor": 0,
  "insulation": 1,
  "bulkiness": 1,
  "allowed_layer_range": {"min": 1, "max": 2}
}'::jsonb),

('item_finger_rings_set', 'set of finger rings', 120, 350, '{
  "description": "Every finger bears a distinctive ring, forming a complete collection of symbolic jewelry: a colorful candy skull ring with intricate enamel detailing; a Tree of Life ring with engraved roots and branches; a bold eagle ring with outstretched wings; a wolf ring featuring a snarling profile; a regal lion-head ring with a sculpted mane; and a black-and-gold signet ring displaying a winged skull emblem, its gold design standing out sharply against the dark face.",
  "slot": "hands",
  "armor": 1,
  "insulation": 0,
  "bulkiness": 1,
  "allowed_layer_range": {"min": 2, "max": 4}
}'::jsonb)

ON CONFLICT (id) DO UPDATE SET
  name   = EXCLUDED.name,
  weight = EXCLUDED.weight,
  value  = EXCLUDED.value,
  tags   = EXCLUDED.tags;

-- Place all items on the ground in zone_apt_2
INSERT INTO player_inventory (id, player_id, item_id, quantity) VALUES
  (gen_random_uuid()::text, '_ground_zone_apt_2', 'item_cobalt_scarf',           1),
  (gen_random_uuid()::text, '_ground_zone_apt_2', 'item_reaper_tshirt',          1),
  (gen_random_uuid()::text, '_ground_zone_apt_2', 'item_gold_chain',             1),
  (gen_random_uuid()::text, '_ground_zone_apt_2', 'item_onyx_malachite_bracelets', 1),
  (gen_random_uuid()::text, '_ground_zone_apt_2', 'item_cyber_track_pants',      1),
  (gen_random_uuid()::text, '_ground_zone_apt_2', 'item_cat_boxers',             1),
  (gen_random_uuid()::text, '_ground_zone_apt_2', 'item_finger_rings_set',       1);
