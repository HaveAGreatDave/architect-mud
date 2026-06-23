import { query } from './db.js';
import { randomUUID, createHash } from 'crypto';

const hashPassword = pw => createHash('sha256').update(pw).digest('hex');

async function seed() {
  // Zones
  const zones = [
    { id: 'zone_start', name: 'The Threshold', description: 'The dead center of Coldwater Basin. A transit hub turned town square. WELCOME TO COLDWATER BASIN reads a banner half-eaten by something. POPULATION: SURVIVING is spraypainted beneath it. A battered Franchise ATM hums against one wall, somehow still online. This is where everyone ends up eventually.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_city_north', south: 'zone_city_south', east: 'zone_city_east', west: 'zone_city_west' }, ambient_events: ["A ragged figure catches your eye and immediately looks away.", "Somewhere, a fast food jingle loops on a dying speaker."], flags: { has_atm: true } },
    { id: 'zone_city_west', name: 'Franchise Strip', description: 'Pre-Handoff retail storefronts, repurposed and argued over for years. Big box skeletons and drive-through lanes now used as livestock pens, retrofitted for survival.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { south: 'zone_city_sw', east: 'zone_start', west: 'zone_badland_w_gate', down: 'zone_residential_lobby' }, ambient_events: ["A vendor shouts: \"AUTHENTIC PRE-HANDOFF CANNED GOODS. ONLY SLIGHTLY EXPIRED.\"", "Two people argue about whether the Architect controls the weather."] },
    { id: 'zone_city_north', name: 'Threshold Plaza North', description: 'A cracked concrete plaza ringed by dead streetlights still standing at attention. This is the northern gate into Coldwater proper — the LED departure boards here flicker through routes that no longer run anywhere.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { south: 'zone_start', east: 'zone_city_ne' }, ambient_events: ["A drone hums overhead, chassis stenciled with a faded corporate logo.", "The departure board flickers: COLDWATER → DENVER → [SIGNAL LOST]."], flags: { custodian_controlled: true, has_turrets: true } },
    { id: 'zone_city_ne', name: 'Custodian Row', description: 'Corporate spires, mostly empty, partially maintained by Custodians who still believe someone is watching the quarterly numbers.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { south: 'zone_city_east', west: 'zone_city_north' }, ambient_events: ["A Custodian in ill-fitting corporate attire hands out pamphlets nobody reads.", "An elevator chimes on a floor that no longer exists."], flags: { custodian_controlled: true } },
    { id: 'zone_city_east', name: 'The Loading Bay', description: 'A vast warehouse complex The Franchise uses as a distribution hub. Forklifts move between shelves stacked to the ceiling. Everything here has a SKU.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_city_ne', south: 'zone_city_se', west: 'zone_start' }, ambient_events: ["An autonomous forklift nearly runs you over. It has a smiley face sticker.", "\"CUSTOMER SATISFACTION IS OUR PRIORITY,\" the speakers insist, less and less convincingly."] },
    { id: 'zone_city_se', name: 'The Clinic Block', description: 'One of the only reliably staffed medical points in the basin. People are polite here. Nobody wants to be the reason it closes.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_city_east', west: 'zone_city_south' }, ambient_events: ["A line forms outside, orderly, almost eerily so.", "Someone hums a tune that might be older than the Handoff."] },
    { id: 'zone_city_south', name: 'The Sprawl Gate', description: 'Where the dense vertical Sprawl tapers into the rest of the city. Laundry lines and extension cords crisscross overhead like a second sky.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_start', east: 'zone_city_se', west: 'zone_city_sw' }, ambient_events: ["Something crashes several floors above. Then laughter.", "A wall screen loops a corporate conflict-resolution training video, forever."] },
    { id: 'zone_city_sw', name: 'The Under Entrance', description: 'A guarded stairwell down into the old subway tunnels. The Archivists\' real vault is below, but this entrance is calm, watched, safe.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_city_west', east: 'zone_city_south' }, ambient_events: ["A train horn sounds in the distance. There are no trains.", "Cold air rises from the stairwell, smelling of paper and rust."] },
    { id: 'zone_badland_w_gate', name: 'The Rust Quarter West', description: 'Industrial wasteland at the western edge. Enormous processing facilities stand half-collapsed, ground stained in colors that don\'t occur in nature. The last buffer between the city and whatever the basin becomes past it.', danger_rating: 'medium', pvp_enabled: 1, radiation_level: 15, is_safe_zone: 0, exits: { south: 'zone_badland_sw_outer', east: 'zone_city_west', west: 'zone_powerplant' }, ambient_events: ["A Geiger counter ticks somewhere nearby, the rhythm wrong for the environment.", "The ruins groan. Structural settling, probably."] },
    { id: 'zone_powerplant', name: 'Coldwater Power Station', description: 'One of the few pieces of pre-Handoff infrastructure that never stopped running. A squat concrete building humming with a sound that never quite stops, vibrating up through the soles of your boots. Warning placards, faded but legible, cover every surface. Whatever\'s turning inside has been turning since before anyone currently alive in the basin was born, and shows no sign of needing fuel, maintenance, or permission to keep doing it.', danger_rating: 'medium', pvp_enabled: 1, radiation_level: 8, is_safe_zone: 0, exits: { east: 'zone_badland_w_gate' }, ambient_events: ["The hum changes pitch for a moment, then settles back.", "Somewhere inside, something massive and patient keeps turning."], flags: { is_building: true, building_name: 'Coldwater Power Station', building_type: 'powerplant' } },
    { id: 'zone_badland_sw_outer', name: 'The Static Wood', description: 'What used to be a park. The trees are still there. They are not doing well — bark peeling back to reveal something too smooth underneath. Past here, the basin stops pretending to be a city at all.', danger_rating: 'low', pvp_enabled: 1, radiation_level: 5, is_safe_zone: 0, exits: { north: 'zone_badland_w_gate' }, ambient_events: ["A branch creaks overhead with no wind to move it.", "The grass here is the wrong shade of green, uniformly."] },
    { id: 'zone_clone_facility', name: 'Coldwater Clone Facility', description: 'Aseptic white tile floor that has long since gone grey at the grout lines. Vat chambers run along both walls — human-sized cylinders of cloudy fluid, most occupied, all humming at a frequency just below the threshold of comfort. Overhead fluorescents pulse with slow, clinical regularity. Somewhere in the walls, a machine breathes. This is where you come from. Every time.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { south: 'zone_city_north' }, ambient_events: ["A vat releases a slow bubble. Something shifts inside.", "The reconstitution system cycles — a low harmonic you feel more than hear.", "A printer somewhere spits out a receipt. Nobody comes to collect it."], flags: { is_building: true, building_name: 'Coldwater Clone Facility', building_type: 'clone_facility' } },

    { id: 'zone_residential_lobby', name: 'Embassy Hotel & Bar — Lobby', description: 'A converted hotel lobby, marble floors gone dull under a permanent film of dust, repurposed into the basin\'s closest thing to real estate. A corkboard by the door — bolted over what used to be the concierge desk — is covered in handwritten unit listings, half of them crossed out. Along one wall, a bar still operates under a brass sign reading THE EMBASSY LOUNGE — a half-dozen cracked vinyl stools lined up at the counter, free to sit if you don\'t mind the wobble. Lowry stands behind it, polishing a glass that was already clean. The building still has working locks upstairs, which around here makes it valuable.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { up: 'zone_city_west', north: 'zone_apt_1', south: 'zone_apt_2', east: 'zone_apt_3', west: 'zone_apt_4' }, ambient_events: ["Someone argues with the building's old intercom system, which only ever says \"PLEASE HOLD.\"", "A hand-written sign reads: UNITS AVAILABLE. ASK ABOUT OUR LOCKS.", "A bellhop cart, empty, still makes its rounds on a track nobody's maintained in years."], flags: { is_building: true, building_name: 'Embassy Hotel & Bar', building_type: 'hotel' } },
    { id: 'zone_apt_1', name: 'Unit 1A', description: 'A small studio with a mattress, a hot plate, and a window that doesn\'t open. It\'s not much, but the door locks, and around here that\'s everything.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { south: 'zone_residential_lobby' }, ambient_events: ["Pipes knock somewhere in the walls. The building is old but it holds."], flags: { is_apartment: true } },
    { id: 'zone_apt_2', name: 'Unit 1B', description: 'A corner unit with two windows, both boarded. Someone before you left a faded poster on the wall — a beach, somewhere, once.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_residential_lobby' }, ambient_events: ["The boarded windows let in thin lines of light that move slowly across the floor."], flags: { is_apartment: true } },
    { id: 'zone_apt_3', name: 'Unit 1C', description: 'A narrow unit, mostly bed and shelving. Whoever lived here last was tidy, methodical, and is conspicuously not here anymore.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { west: 'zone_residential_lobby' }, ambient_events: ["The shelves are bolted to the wall, every one perfectly level."], flags: { is_apartment: true } },
    { id: 'zone_apt_4', name: 'Unit 1D', description: 'A larger unit, big enough to actually pace in. The previous tenant left graffiti on the inside of the door: COUNT YOUR DAYS.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { east: 'zone_residential_lobby' }, ambient_events: ["The graffiti on the door is in a careful, practiced hand. Not a first attempt at writing it."], flags: { is_apartment: true } },
  ];
  for (const z of zones) {
    await query(`INSERT INTO zones (id,name,description,danger_rating,pvp_enabled,radiation_level,is_safe_zone,exits,ambient_events,flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
      [z.id,z.name,z.description,z.danger_rating,z.pvp_enabled,z.radiation_level,z.is_safe_zone,JSON.stringify(z.exits),JSON.stringify(z.ambient_events),JSON.stringify(z.flags||{})]);
  }
  console.log(`✓ Seeded ${zones.length} zones`);

  // --- Patches for databases already seeded before this content wave ---
  // (ON CONFLICT DO NOTHING above won't touch rows that already exist, so
  // anything that changed shape — renamed/moved/re-flagged — needs an
  // explicit, idempotent UPDATE here instead of relying on the insert.)

  // Clean up the standalone Embassy zone/NPC from an earlier version of
  // this content, since the Embassy concept now lives in the residential
  // lobby instead of its own separate zone.
  await query(`DELETE FROM npcs WHERE id = 'npc_embassy_barkeep' AND zone_id = 'zone_embassy_lobby'`);
  await query(`DELETE FROM zones WHERE id = 'zone_embassy_lobby'`);

  // Map shrink: the badlands ring and zone_city_nw were cut down to a
  // single buffer tile (zone_badland_w_gate) and a single wasteland tile
  // (zone_badland_sw_outer) beyond it. On a database seeded before this
  // change, those zone rows — and everything that pointed at them — are
  // still sitting there. Clean it all out, in FK-safe order, and rescue
  // any player whose current_zone is about to disappear (the in-memory/
  // live side of that, for anyone connected when this runs, is handled by
  // the server's own zone-deletion safety net — this just fixes the DB).
  const removedZoneIds = [
    'zone_badland_nw_corner','zone_badland_n_outer','zone_badland_n_gate',
    'zone_badland_ne_outer','zone_badland_ne_corner','zone_badland_w_outer',
    'zone_badland_e_outer','zone_badland_e_gate','zone_badland_sw_corner',
    'zone_badland_s_outer','zone_badland_s_gate','zone_badland_se_inner',
    'zone_badland_se_outer','zone_badland_se_corner','zone_city_nw',
  ];
  await query(`DELETE FROM apartments WHERE zone_id = ANY($1::text[])`, [removedZoneIds]);
  await query(`DELETE FROM npcs WHERE zone_id = ANY($1::text[])`, [removedZoneIds]);
  await query(`DELETE FROM furniture WHERE zone_id = ANY($1::text[])`, [removedZoneIds]);
  await query(`DELETE FROM zone_spawns WHERE zone_id = ANY($1::text[])`, [removedZoneIds]);
  await query(`UPDATE players SET current_zone = 'zone_start' WHERE current_zone = ANY($1::text[])`, [removedZoneIds]);
  const { rowCount: removedZoneCount } = await query(`DELETE FROM zones WHERE id = ANY($1::text[])`, [removedZoneIds]);
  if (removedZoneCount) console.log(`✓ Map shrink: removed ${removedZoneCount} old zones`);

  // Clone Facility: wire zone_city_north's north exit to the new zone,
  // only if nothing is already using that direction.
  await query(`UPDATE zones SET exits = exits || '{"north":"zone_clone_facility"}'::jsonb WHERE id = 'zone_city_north' AND NOT (exits ? 'north')`);

  // Clone Facility: make it the default spawn and respawn zone for new
  // players. Players with an anchor still pointing at zone_start are
  // migrated forward; anyone who explicitly set a different anchor is left alone.
  await query(`ALTER TABLE players ALTER COLUMN current_zone SET DEFAULT 'zone_clone_facility'`).catch(()=>{});
  await query(`ALTER TABLE players ALTER COLUMN anchor_zone SET DEFAULT 'zone_clone_facility'`).catch(()=>{});
  await query(`UPDATE players SET anchor_zone = 'zone_clone_facility' WHERE anchor_zone = 'zone_start'`);

  // zone_start: drop its old 'down' exit to the lobby (only if it's still
  // pointing there — leaves it alone if a dev already repointed it by hand),
  // and drop the stale 'up' exit from the earlier version of this patch.
  await query(`UPDATE zones SET exits = exits - 'down' WHERE id = 'zone_start' AND exits->>'down' = 'zone_residential_lobby'`);
  await query(`UPDATE zones SET exits = exits - 'up' WHERE id = 'zone_start' AND exits->>'up' = 'zone_embassy_lobby'`);

  // zone_city_west (Franchise Strip): add the new 'down' exit, only if
  // nothing's already using that direction.
  await query(`UPDATE zones SET exits = exits || '{"down":"zone_residential_lobby"}'::jsonb WHERE id = 'zone_city_west' AND NOT (exits ? 'down')`);

  // zone_residential_lobby: repoint 'up' from the Threshold to Franchise
  // Strip, and sync name/description/flags in case this zone already
  // existed under its old "Coldwater Residences" identity.
  await query(`UPDATE zones SET exits = jsonb_set(exits, '{up}', '"zone_city_west"') WHERE id = 'zone_residential_lobby' AND exits->>'up' = 'zone_start'`);
  await query(`
    UPDATE zones SET name = $1, description = $2, flags = flags || $3::jsonb
    WHERE id = 'zone_residential_lobby'
  `, [
    'Embassy Hotel & Bar — Lobby',
    'A converted hotel lobby, marble floors gone dull under a permanent film of dust, repurposed into the basin\'s closest thing to real estate. A corkboard by the door — bolted over what used to be the concierge desk — is covered in handwritten unit listings, half of them crossed out. Along one wall, a bar still operates under a brass sign reading THE EMBASSY LOUNGE — a half-dozen cracked vinyl stools lined up at the counter, free to sit if you don\'t mind the wobble. Lowry stands behind it, polishing a glass that was already clean. The building still has working locks upstairs, which around here makes it valuable.',
    JSON.stringify({ is_building: true, building_name: 'Embassy Hotel & Bar', building_type: 'hotel' }),
  ]);

  // Factions
  const factions = [
    { id: 'faction_custodians', name: 'The Custodians', description: 'Former corporate employees who serve the Architect as a divine entity.', color: '#4A90D9', hostile_to: ['faction_breakers'], friendly_to: [] },
    { id: 'faction_breakers', name: 'The Breakers', description: 'Technology abolitionists. Believe destroying all remaining tech will free humanity.', color: '#D94A4A', hostile_to: ['faction_custodians','faction_glitch'], friendly_to: [] },
    { id: 'faction_archivists', name: 'The Archivists', description: 'Knowledge hoarders operating from the tunnels. Politically neutral. Deeply weird.', color: '#F5A623', hostile_to: [], friendly_to: [] },
    { id: 'faction_franchise', name: 'The Franchise', description: 'A commerce empire built on pre-Handoff retail bones. If it can be sold, they sell it.', color: '#7ED321', hostile_to: [], friendly_to: [] },
    { id: 'faction_glitch', name: 'The Glitch', description: 'Hackers and post-Handoff mystics who believe the Architect can be communicated with.', color: '#9B59B6', hostile_to: ['faction_breakers'], friendly_to: ['faction_archivists'] },
  ];
  for (const f of factions) {
    await query(`INSERT INTO factions (id,name,description,color,hostile_to,friendly_to) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [f.id,f.name,f.description,f.color,JSON.stringify(f.hostile_to),JSON.stringify(f.friendly_to)]);
  }
  console.log(`✓ Seeded ${factions.length} factions`);

  // Enemies
  const enemies = [
    { id: 'enemy_scav', name: 'Desperate Scavenger', description: 'Sunburned, twitchy, armed with something sharp.', stat_str:4,stat_agi:6,stat_end:3,hp_max:22,damage_min:2,damage_max:5,armor:0,xp_reward:8,credit_reward:5, loot_table:[{item:'item_scrap_metal',weight:80,qty:[1,3]},{item:'item_ration',weight:40,qty:[1,1]},{item:'item_credits_small',weight:60}], behavior:'aggressive', faction:null, death_message:'The scavenger collapses with an expression of profound disappointment.', flags:{first_strike_delay_ms:3000, battle_cries:["eyes you and hisses, \"M-mine. Find your own turf.\"","shouts, \"I just need ONE good day!\"","snarls, \"Don't make me do this!\""]} },
    { id: 'enemy_feral_dog', name: 'Feral Dog', description: 'Once someone\'s pet. Now a forty-pound argument for not going outside.', stat_str:3,stat_agi:7,stat_end:2,hp_max:16,damage_min:2,damage_max:5,armor:0,xp_reward:5,credit_reward:0, loot_table:[{item:'item_raw_meat',weight:70,qty:[1,2]}], behavior:'aggressive', faction:null, death_message:'The dog goes down. You feel bad about it for approximately three seconds before checking for loot.', flags:{first_strike_delay_ms:500, battle_cries:["snarls and bares its teeth.","lets out a ragged, hungry growl."]} },
    { id: 'enemy_rad_mutant', name: 'Rad Mutant', description: 'Something that used to be human. The Bleed does this. The extra limb is load-bearing.', stat_str:8,stat_agi:3,stat_end:7,hp_max:65,damage_min:7,damage_max:14,armor:2,xp_reward:20,credit_reward:0, loot_table:[{item:'item_mutant_gland',weight:50,qty:[1,1]}], behavior:'aggressive', faction:null, death_message:'The mutant folds in on itself in a way that suggests the laws of anatomy were more like suggestions.', flags:{radiates:true,radiation_damage:5, first_strike_delay_ms:4500, battle_cries:["lets out a wet, guttural moan as it lumbers toward you.","makes a sound that used to be a sentence."]} },
    { id: 'enemy_custodian_enforcer', name: 'Custodian Enforcer', description: 'Polo shirt. Khaki pants. Body armor under both. The most dangerous middle manager you\'ll ever meet.', stat_str:6,stat_agi:5,stat_end:6,hp_max:55,damage_min:5,damage_max:10,armor:3,xp_reward:18,credit_reward:15, loot_table:[{item:'item_custodian_badge',weight:80},{item:'item_credits_medium',weight:60}], behavior:'territorial', faction:'faction_custodians', death_message:'Employee of the Month, the badge reads. Third quarter, four years running.', flags:{first_strike_delay_ms:1500, battle_cries:["says, \"I'm going to need you to stop doing that.\"","says, \"This is a Custodian-managed zone. Please comply.\""]} },
    { id: 'enemy_architect_drone', name: 'Architect Scout Drone', description: 'A black hexagonal drone about the size of a dinner plate. No insignia. Watching.', stat_str:2,stat_agi:10,stat_end:4,hp_max:30,damage_min:8,damage_max:15,armor:5,xp_reward:30,credit_reward:0, loot_table:[{item:'item_drone_core',weight:40},{item:'item_architect_fragment',weight:15}], behavior:'patrol', faction:null, death_message:'The drone spirals down. Somewhere, something notices.', flags:{flies:true,architect_aligned:true, battle_cries:["emits a flat, synthesized tone that might be a warning."]} },
  ];
  for (const e of enemies) {
    await query(`INSERT INTO enemies (id,name,description,stat_str,stat_agi,stat_end,hp_max,damage_min,damage_max,armor,xp_reward,credit_reward,loot_table,behavior,faction,death_message,flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (id) DO NOTHING`,
      [e.id,e.name,e.description,e.stat_str,e.stat_agi,e.stat_end,e.hp_max,e.damage_min,e.damage_max,e.armor,e.xp_reward,e.credit_reward,JSON.stringify(e.loot_table),e.behavior,e.faction,e.death_message,JSON.stringify(e.flags)]);
  }
  console.log(`✓ Seeded ${enemies.length} enemies`);

  // Zone spawns — badlands only. The city core (zone_start, zone_city_*) is
  // always safe; enemies never spawn there. The map was trimmed down to a
  // single buffer tile and a single wasteland tile beyond it, so this list
  // is just those two now instead of a full badlands ring.
  const spawns = [
    ['zone_badland_w_gate','enemy_scav',2,70,200],
    ['zone_badland_w_gate','enemy_feral_dog',2,55,160],
    ['zone_badland_sw_outer','enemy_scav',2,65,210],
  ];
  for (const [zone_id,enemy_id,max_count,spawn_weight,respawn_seconds] of spawns) {
    await query(`INSERT INTO zone_spawns (id,zone_id,enemy_id,max_count,spawn_weight,respawn_seconds) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [randomUUID(),zone_id,enemy_id,max_count,spawn_weight,respawn_seconds]);
  }
  console.log(`✓ Seeded ${spawns.length} zone spawns`);

  // Apartments — unowned by default, ready for players to RENT
  const apartmentZones = ['zone_apt_1', 'zone_apt_2', 'zone_apt_3', 'zone_apt_4'];
  for (const zoneId of apartmentZones) {
    await query(
      `INSERT INTO apartments (zone_id, owner_id, is_locked, lock_difficulty, rent_cost) VALUES ($1,NULL,0,4,100) ON CONFLICT (zone_id) DO NOTHING`,
      [zoneId]
    );
  }
  console.log(`✓ Seeded ${apartmentZones.length} apartments`);

  // Recipes — dev-panel editable, cached in memory at runtime
  const recipes = [
    { id:'recipe_pipe_weapon', name:'Pipe Wrench', description:'Combine scrap metal into a crude but effective blunt weapon.', category:'weapons', requires_station:null, skill_req:{fabrication:0}, ingredients:[{item_id:'item_scrap_metal',quantity:3,min_quality:'scrap'}], base_output:{item_id:'item_pipe_wrench',quantity:1}, skill_id:'fabrication', base_difficulty:3 },
    { id:'recipe_bandage', name:'Field Bandage', description:'Tear cloth into bandages. Requires nothing but desperation.', category:'medicine', requires_station:null, skill_req:{medicine:0}, ingredients:[{item_id:'item_scrap_metal',quantity:0}], base_output:{item_id:'item_bandage',quantity:2}, skill_id:'medicine', base_difficulty:2 },
    { id:'recipe_rad_pills_crude', name:'Crude RadAway', description:'Improvised radiation treatment. Effective. Unpleasant.', category:'medicine', requires_station:'chemistry_set', skill_req:{medicine:3,fabrication:1}, ingredients:[{item_id:'item_mutant_gland',quantity:1,min_quality:'common'}], base_output:{item_id:'item_rad_pills',quantity:2}, skill_id:'medicine', base_difficulty:6 },
    { id:'recipe_scrap_armor', name:'Scrap Vest', description:'Layer metal sheeting over salvaged clothing. Crude but it absorbs hits.', category:'armor', requires_station:null, skill_req:{fabrication:1}, ingredients:[{item_id:'item_scrap_metal',quantity:5,min_quality:'scrap'}], base_output:{item_id:'item_scrap_armor',quantity:1}, skill_id:'fabrication', base_difficulty:4 },
    { id:'recipe_glitch_decoder', name:'Architect Signal Decoder', description:'Assembles a device that can interpret Architect data fragments. Requires high skill and rare parts.', category:'tech', requires_station:'architect_terminal', skill_req:{hacking:5,electronics:4}, ingredients:[{item_id:'item_drone_core',quantity:1,min_quality:'common'},{item_id:'item_architect_fragment',quantity:1,min_quality:'common'}], base_output:{item_id:'item_signal_decoder',quantity:1}, skill_id:'hacking', base_difficulty:10 },
  ];
  for (const r of recipes) {
    await query(
      `INSERT INTO recipes (id,name,description,category,requires_station,skill_req,ingredients,base_output,skill_id,base_difficulty) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
      [r.id,r.name,r.description,r.category,r.requires_station,JSON.stringify(r.skill_req),JSON.stringify(r.ingredients),JSON.stringify(r.base_output),r.skill_id,r.base_difficulty]
    );
  }
  console.log(`✓ Seeded ${recipes.length} recipes`);

  // Drug items + drug definitions. The item half is just identity + the
  // drug/stackable markers; the mechanical half lives in the drugs table.
  const drugItems = [
    ['item_drug_buzz','Buzz',0.1,8,'common',{ description:'A cheap stimulant tab. Tastes like batteries.', drug:true, stackable:true }],
    ['item_drug_slow','Slow',0.2,15,'uncommon',{ description:'A thick blue syrup. Time gets soft.', drug:true, stackable:true }],
    ['item_drug_glasshollow','Glasshollow',0.1,40,'rare',{ description:"Architect-adjacent. Nobody's sure what it actually is. People take it anyway.", drug:true, stackable:true }],
  ];
  for (const [id,name,weight,value,rarity,tags] of drugItems) {
    await query(`INSERT INTO items (id,name,weight,value,rarity,tags) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [id,name,weight,value,rarity,JSON.stringify(tags)]);
  }

  const drugs = [
    { id:'drug_buzz', name:'Buzz', description:'A jittery, short-lived stimulant. Common in the Franchise Strip.', item_id:'item_drug_buzz', duration_seconds:240, effects:{stat_agi_temp:2,hunger:-5}, addiction_chance:0.04, overdose_threshold:3, withdrawal_effects:{overdose:{hp:-10,sanity:-5}} },
    { id:'drug_slow', name:'Slow', description:'Dulls pain and panic. Popular with people who have seen too much.', item_id:'item_drug_slow', duration_seconds:600, effects:{sanity:15,hp:5}, addiction_chance:0.12, overdose_threshold:2, withdrawal_effects:{overdose:{hp:-20,sanity:-15}} },
    { id:'drug_glasshollow', name:'Glasshollow', description:'Architect-adjacent. Reality gets thin and strange. Sanity damage is real; so is whatever you see.', item_id:'item_drug_glasshollow', duration_seconds:180, effects:{sanity:-10,radiation:5}, addiction_chance:0.2, overdose_threshold:2, withdrawal_effects:{overdose:{hp:-25,sanity:-30}} },
  ];
  for (const d of drugs) {
    await query(
      `INSERT INTO drugs (id,name,description,item_id,duration_seconds,effects,addiction_chance,overdose_threshold,withdrawal_effects) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [d.id,d.name,d.description,d.item_id,d.duration_seconds,JSON.stringify(d.effects),d.addiction_chance,d.overdose_threshold,JSON.stringify(d.withdrawal_effects)]
    );
  }
  console.log(`✓ Seeded ${drugs.length} drugs`);

  // Mutations — mix of polarity, some visible (drives Custodian outcast checks), some hidden
  const mutations = [
    { id:'mut_extra_eye', name:'Extra Eye', description:'A third eye has opened on the back of your skull. You see things people don\'t.', polarity:'mixed', visible:true, stat_modifiers:{stat_agi:1}, effects:{perception_bonus:2}, drawbacks:['NPCs find you unsettling'], rarity:'uncommon', radiation_threshold:60 },
    { id:'mut_necrotic_hand', name:'Necrotic Hand', description:'One hand has darkened and hardened. Melee attacks cause bleeding. You can\'t wear gloves.', polarity:'mixed', visible:true, stat_modifiers:{}, effects:{status_on_hit:'bleeding',chance:0.3}, drawbacks:['Cannot equip gloves'], rarity:'uncommon', radiation_threshold:50 },
    { id:'mut_static_mind', name:'Static Mind', description:'Your thoughts are a white noise channel. Partial immunity to sanity loss. Architect signals are louder.', polarity:'positive', visible:false, stat_modifiers:{stat_wil:2}, effects:{sanity_drain_reduction:0.5}, drawbacks:['Occasional intrusive Architect messages'], rarity:'rare', radiation_threshold:70 },
    { id:'mut_iron_stomach', name:'Iron Stomach', description:'You can eat almost anything. Food poisoning is no longer a concern. What is a concern is what you now find appetizing.', polarity:'positive', visible:false, stat_modifiers:{stat_end:1}, effects:{food_poison_immunity:true}, drawbacks:[], rarity:'common', radiation_threshold:40 },
    { id:'mut_rad_absorption', name:'Rad Absorption', description:'Your body has learned to metabolize radiation instead of being destroyed by it. Slowly.', polarity:'positive', visible:true, stat_modifiers:{stat_end:2}, effects:{rad_resistance:0.3}, drawbacks:['You glow faintly in the dark — stealth is harder'], rarity:'rare', radiation_threshold:80 },
    { id:'mut_bone_spurs', name:'Bone Spurs', description:'Calcified projections have erupted through your knuckles. Unarmed attacks deal more damage and cause bleeding.', polarity:'mixed', visible:true, stat_modifiers:{stat_str:1}, effects:{unarmed_damage_bonus:3,unarmed_bleed_chance:0.25}, drawbacks:['Gloves don\'t fit'], rarity:'uncommon', radiation_threshold:55 },
    { id:'mut_weeping_sores', name:'Weeping Sores', description:'Open lesions that never quite heal. Purely cosmetic. Purely awful.', polarity:'negative', visible:true, stat_modifiers:{stat_cha:-2}, effects:{}, drawbacks:['Visibly diseased — NPCs react poorly'], rarity:'common', radiation_threshold:45 },
    { id:'mut_tremor_hands', name:'Tremor Hands', description:'Your hands shake constantly now. Fine motor tasks are a struggle.', polarity:'negative', visible:false, stat_modifiers:{stat_agi:-1}, effects:{}, drawbacks:['Crafting and lockpicking rolls take a penalty'], rarity:'common', radiation_threshold:40 },
  ];
  for (const m of mutations) {
    await query(
      `INSERT INTO mutations (id,name,description,polarity,visible,stat_modifiers,effects,drawbacks,rarity,radiation_threshold) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
      [m.id,m.name,m.description,m.polarity,m.visible?1:0,JSON.stringify(m.stat_modifiers),JSON.stringify(m.effects),JSON.stringify(m.drawbacks),m.rarity,m.radiation_threshold]
    );
  }
  console.log(`✓ Seeded ${mutations.length} mutations`);

  // Items — all behavior lives in the `tags` object (the single source of
  // truth; see client/shared/tagCatalog.js). Identity/economy stays scalar:
  // [id, name, weight, value, rarity, tags].
  const items = [
    ['item_scrap_metal','Scrap Metal',1.5,2,'common',{ description:'Bent rebar and sheet aluminum.', material:true, stackable:true }],
    ['item_ration','Vacuum Ration',0.3,8,'common',{ description:'Pre-Handoff emergency ration. Flavor: SAVORY.', consumable:true, stackable:true, restore_hunger:25, well_fed:true }],
    ['item_water_bottle','Filtered Water',0.5,5,'common',{ description:'Aggressively filtered water.', consumable:true, stackable:true, restore_thirst:40, hydrating:true }],
    ['item_rad_pills','RadAway™',0.1,25,'uncommon',{ description:'Bright orange pills. Tastes like failure and citrus.', consumable:true, stackable:true, restore_radiation:-20 }],
    ['item_bandage','Field Bandage',0.2,10,'common',{ description:'Gauze and tape. Stops bleeding, eventually — not instantly, whatever the label implies.', consumable:true, stackable:true, heal_over_time:{ amount:18, duration_seconds:180 } }],
    ['item_medkit','Trauma Kit',1.2,55,'uncommon',{ description:'Real medical supplies. Increasingly rare, increasingly suspicious about why someone is selling them.', consumable:true, stackable:true, heal_over_time:{ amount:50, duration_seconds:300 } }],
    ['item_pipe_wrench','Pipe Wrench',2.5,30,'common',{ description:'Heavy. Reliable. Pre-used.', weapon:true, weapon_skill:'blunt', slot:'weapon_hand', damage:{ min:4, max:9 }, stat_bonus:{ stat_brawn:3 } }],
    ['item_rusty_knife','Rusty Knife',0.4,15,'common',{ description:'A kitchen knife that has seen things.', weapon:true, weapon_skill:'bladed', slot:'weapon_hand', damage:{ min:3, max:7 } }],
    ['item_scrap_armor','Scrap Vest',4.0,45,'common',{ description:'Metal sheeting over a leather jacket.', slot:'torso' }],
    ['item_custodian_badge','Custodian ID Badge',0.05,40,'uncommon',{ description:'Useful for bluffing Custodian checkpoints.', misc:true }],
    ['item_drone_core','Drone Processing Core',0.8,120,'rare',{ description:'Still warm. Still probably logging.', material:true }],
    ['item_architect_fragment','Architect Data Fragment',0.1,300,'very_rare',{ description:'Pulses faint blue. Three factions want this.', misc:true }],
    ['item_taser','Custodian Taser',0.6,65,'uncommon',{ description:'Corporate-issue stun weapon.', weapon:true, weapon_skill:'energy', slot:'weapon_hand', damage:{ min:5, max:8 }, status_chance:{ stunned:0.3 }, stat_bonus:{ stat_reflexes:4 } }],
    ['item_raw_meat','Raw Meat',0.6,3,'common',{ description:'Something used to own this. Cook before eating.', consumable:true, stackable:true, restore_hunger:15, status_chance:{ food_poisoning:0.6 } }],
    ['item_mutant_gland','Mutant Gland',0.4,35,'uncommon',{ description:'Iridescent and foul. Worth money to the right people.', material:true, stackable:true }],
    ['item_credits_small','Credits (Small)',0,0,'common',{ description:'Franchise-issued digital credit chips.', currency:true, stackable:true, grants_credits:10 }],
    ['item_credits_medium','Credits (Medium)',0,0,'common',{ description:'A credit chip worth more than your clothing.', currency:true, stackable:true, grants_credits:35 }],
    ['item_scrap_helmet','Scrap Helmet',1.0,20,'common',{ description:'A motorcycle helmet with extra rivets. Visor status: optimistic.', slot:'head' }],
    ['item_cargo_pants','Reinforced Cargo Pants',1.5,18,'common',{ description:'Pockets for days. Knees patched twice over.', slot:'legs' }],
    ['item_steel_boots','Steel-Toed Boots',1.2,16,'common',{ description:'Standard issue, several owners ago.', slot:'feet' }],
    ['item_rad_band','Rad-Counter Wristband',0.1,25,'uncommon',{ description:'Clicks faster the worse your day is going.', misc:true, slot:'accessory' }],
    ['item_work_gloves','Work Gloves',0.3,8,'common',{ description:'Stained in ways you choose not to think about.', slot:'hands' }],
    ['item_drink_basin_swill','Basin Swill',0.4,4,'common',{ description:"House drink. Nobody has ever asked what's in it twice.", consumable:true, stackable:true, restore_thirst:15, restore_sanity:3, hydrating:true }],
    ['item_drink_rust_whiskey','Rust Whiskey',0.4,9,'common',{ description:"Tastes like it was filtered through the pipe it's named after. Probably was.", consumable:true, stackable:true, restore_thirst:10, restore_sanity:8, restore_hp:-2, hydrating:true }],
    ['item_drink_glow_cocktail','Glow Cocktail',0.4,14,'uncommon',{ description:'Faintly luminescent. The bartender swears the radiation is "mostly cosmetic."', consumable:true, stackable:true, restore_thirst:12, restore_sanity:12, restore_radiation:4, hydrating:true }],
    ['item_drink_embassy_reserve','Embassy Reserve',0.4,22,'rare',{ description:"Aged in what used to be a wine cellar and is now mostly intact. The only drink in the basin served with a paper umbrella, against everyone's better judgment.", consumable:true, stackable:true, restore_thirst:18, restore_sanity:18, restore_hp:3, hydrating:true }],
    ['item_embassy_canapes','Embassy Canapés',0.2,9,'uncommon',{ description:"Bite-sized, garnished, served on an actual plate. Nobody asks what's in them; the presentation is doing all the work.", consumable:true, stackable:true, restore_hunger:14, restore_sanity:5, well_fed:true }],
    ['item_bar_jerky','Mystery Jerky',0.2,6,'common',{ description:'Labeled "MEAT-ADJACENT." Surprisingly not the worst thing on the menu.', consumable:true, stackable:true, restore_hunger:18, well_fed:true }],
    ['item_riot_vest','Riot Plate Vest',5.5,140,'uncommon',{ description:'Custodian crowd-control plating. Stops bullets and blades; useless against a live wire.', slot:'torso', armor_soak:{ kinetic:6, edged:4, energy:1 } }],
    ['item_insulated_gloves','Insulated Gauntlets',0.6,95,'uncommon',{ description:'Lineman’s gloves rated for things that arc. Padding is an afterthought.', slot:'hands', armor_soak:{ energy:5, fire:3, kinetic:1 } }],
  ];
  for (const [id,name,weight,value,rarity,tags] of items) {
    await query(`INSERT INTO items (id,name,weight,value,rarity,tags) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [id,name,weight,value,rarity,JSON.stringify(tags)]);
  }
  console.log(`✓ Seeded ${items.length} items`);

  // Furniture — non-takeable scenery, examine-only. Stocking the Embassy
  // Hotel & Bar lobby as the first real test of the system: the bar
  // counter, stools, and corkboard the zone's own description already
  // mentions are now individually examine-able. Idempotent (DO UPDATE)
  // since this is exactly the kind of content an admin re-seeds while
  // testing the dev panel's add/edit/delete flow.
  const furniture = [
    ['furniture_poster_combat','zone_clone_facility','Reconstitution Notice — Combat','Laminated government-issue. PHYSICAL CONFLICT IS LIKELY reads the header, with the weary authority of a sign that gave up being alarming years ago. Lists the basics: type ATTACK <target> or click an enemy to engage. You swing automatically once combat starts — don\'t spam the button. Watch HP. When it hits zero, you come back here.','fixture'],
    ['furniture_poster_movement','zone_clone_facility','Reconstitution Notice — Navigation','COLDWATER BASIN IS LARGE AND MOSTLY HOSTILE, says the header. Movement commands: NORTH, SOUTH, EAST, WEST, UP, DOWN — or click the exit buttons in your HUD. GO <name> works for named buildings. The minimap in the corner updates as you explore. Exits listed in room descriptions are the only ways through.','fixture'],
    ['furniture_poster_economy','zone_clone_facility','Reconstitution Notice — Economy','CREDITS ARE THE BASIN\'S CURRENCY. Earn them from loot, vendors, and quests. BALANCE shows your current total. BUY and SELL work at vendor NPCs. The Franchise ATM at Threshold Plaza handles deposits and withdrawals. Housing costs credits — RENT a unit at the Embassy Hotel to get a safe place to sleep.','fixture'],
    ['furniture_poster_survival','zone_clone_facility','Reconstitution Notice — Survival','FOUR BARS CAN KILL YOU reads the header, in what was probably meant to be an encouraging font. HP: take damage, it drops — bandages and medkits restore it. Hunger and Thirst drain over time; eat and drink. Radiation accumulates in high-RAD zones; RadAway treats it. Sanity degrades under stress; food, rest, and substances help. All four bottoming out causes death. You\'ve now been briefed.','fixture'],
    ['furniture_poster_systems','zone_clone_facility','Reconstitution Notice — Systems Overview','A dense wall chart covering factions (Custodians, Breakers, Archivists, Franchise, Glitch), crafting (CRAFT in your inventory), skill advancement (use skills to improve them), mutations (radiation exposure, not recommended), apartments (private, lockable, sleep-safe), and the Architect (unknown, omnipresent, the reason any of this infrastructure still works). A footnote: THIS FACILITY IS MAINTAINED BY THE ARCHITECT. DO NOT ASK HOW.','fixture'],
    ['furniture_embassy_bar_counter','zone_residential_lobby','The Embassy Lounge Bar','A scarred wooden counter beneath the brass THE EMBASSY LOUNGE sign. Lowry keeps it spotless out of sheer habit.','fixture'],
    ['furniture_embassy_stools','zone_residential_lobby','Cracked Vinyl Stools','A half-dozen stools lined up at the counter, vinyl split and patched with duct tape. Free to sit, if you don\'t mind the wobble.','furniture'],
    ['furniture_embassy_corkboard','zone_residential_lobby','Unit Listings Corkboard','Bolted over what used to be the concierge desk. Handwritten unit listings cover every inch, half of them crossed out and re-listed at a worse price.','fixture'],
  ];
  for (const [id,zoneId,name,desc,objectType] of furniture) {
    await query(`INSERT INTO furniture (id,zone_id,name,description,flags,object_type) VALUES ($1,$2,$3,$4,'{}', $5)
      ON CONFLICT (id) DO UPDATE SET zone_id = EXCLUDED.zone_id, name = EXCLUDED.name, description = EXCLUDED.description, object_type = EXCLUDED.object_type`,
      [id,zoneId,name,desc,objectType]);
  }
  console.log(`✓ Seeded ${furniture.length} furniture`);

  // Lights — overhead lights and lamps are player-switchable (the "switch"
  // command, room by room); street lights are NOT — they're city-grid
  // infrastructure that follows the day/night cycle automatically instead
  // (see environment.js's tick30m). Seeded "on" here, matching the
  // generators below starting in the running state; environment.js
  // re-syncs street lights to the actual current time on every boot.
  const lights = [
    ['furniture_clone_facility_overhead','zone_clone_facility','Facility Overhead Lights','Banks of fluorescent lights mounted in waterproof housings. They never turn off. They have never turned off.','overhead'],
    ['furniture_embassy_overhead','zone_residential_lobby','Lobby Overhead Lights','A row of caged fluorescent fixtures along the ceiling, humming faintly. A switch by the door controls them.','overhead'],
    ['furniture_embassy_bar_lamp','zone_residential_lobby','Bar Lamp','A small brass lamp at the end of the counter — the one bit of lighting in the room that isn\'t fluorescent.','lamp'],
    ['furniture_apt1_overhead','zone_apt_1','Overhead Light','A bare bulb on a pull-chain. Functional, nothing more.','overhead'],
    ['furniture_apt2_overhead','zone_apt_2','Overhead Light','A bare bulb on a pull-chain. Functional, nothing more.','overhead'],
    ['furniture_apt3_overhead','zone_apt_3','Overhead Light','A bare bulb on a pull-chain. Functional, nothing more.','overhead'],
    ['furniture_apt4_overhead','zone_apt_4','Overhead Light','A bare bulb on a pull-chain. Functional, nothing more.','overhead'],
  ];
  for (const [id,zoneId,name,desc,lightType] of lights) {
    await query(`INSERT INTO furniture (id,zone_id,name,description,flags,object_type,light_on,light_type) VALUES ($1,$2,$3,$4,'{}','light',1,$5)
      ON CONFLICT (id) DO UPDATE SET zone_id = EXCLUDED.zone_id, name = EXCLUDED.name, description = EXCLUDED.description, object_type = 'light', light_type = EXCLUDED.light_type`,
      [id,zoneId,name,desc,lightType]);
  }
  console.log(`✓ Seeded ${lights.length} lights`);

  // Street lights — one per outdoor zone (including the power station's
  // own approach road), city-power, not player-switchable.
  const outdoorZoneIds = [
    'zone_start','zone_city_west','zone_city_north','zone_city_ne','zone_city_east',
    'zone_city_se','zone_city_south','zone_city_sw','zone_badland_w_gate',
    'zone_badland_sw_outer','zone_powerplant',
  ];
  for (const zoneId of outdoorZoneIds) {
    const id = `furniture_streetlight_${zoneId}`;
    await query(
      `INSERT INTO furniture (id,zone_id,name,description,flags,object_type,light_on,light_type) VALUES ($1,$2,$3,$4,'{}','light',1,'streetlight')
       ON CONFLICT (id) DO UPDATE SET zone_id = EXCLUDED.zone_id, object_type = 'light', light_type = 'streetlight'`,
      [id, zoneId, 'Street Lights', 'A row of city-grid streetlights on cracked poles, wired back to the power station. No switch out here — they come on by themselves once it gets dark.']
    );
  }
  console.log(`✓ Seeded ${outdoorZoneIds.length} street lights`);

  // Power grid — the power station is the city-wide generator for every
  // street light and outdoor zone; the Embassy gets its own building
  // generator covering its lobby and all 4 connected units. Both are
  // permanent (no fuel) and start running, with every dependent light on.
  await query(`
    INSERT INTO generators (id, zone_id, name, generator_type, capacity_kw, fuel_type, fuel_remaining, fuel_burn_rate, connection_range, status)
    VALUES ('city_plant', 'zone_powerplant', 'Coldwater Power Station', 'city_plant', 500, NULL, 0, 0, 0, 'online')
    ON CONFLICT (id) DO UPDATE SET zone_id = 'zone_powerplant', name = 'Coldwater Power Station', status = 'online'
  `);
  await query(`
    INSERT INTO generators (id, zone_id, name, generator_type, capacity_kw, fuel_type, fuel_remaining, fuel_burn_rate, connection_range, status)
    VALUES ('gen_embassy', 'zone_residential_lobby', 'Embassy Backup Generator', 'building', 50, NULL, 0, 0, 0, 'online')
    ON CONFLICT (id) DO UPDATE SET zone_id = 'zone_residential_lobby', name = 'Embassy Backup Generator', status = 'online'
  `);
  await query(`
    INSERT INTO generators (id, zone_id, name, generator_type, capacity_kw, fuel_type, fuel_remaining, fuel_burn_rate, connection_range, status)
    VALUES ('gen_clone_facility', 'zone_clone_facility', 'Clone Facility Power Core', 'building', 100, NULL, 0, 0, 0, 'online')
    ON CONFLICT (id) DO UPDATE SET zone_id = 'zone_clone_facility', name = 'Clone Facility Power Core', status = 'online'
  `);

  async function seedPowerZone(zoneId, generatorId, sourceType, capacityKw, loadKw) {
    const zoneRow = zones.find(z => z.id === zoneId);
    await query(`
      INSERT INTO power_zones (id, name, source_type, generator_id, capacity_kw, current_load_kw, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'powered')
      ON CONFLICT (id) DO UPDATE SET name = $2, source_type = $3, generator_id = $4, capacity_kw = $5
    `, [zoneId, zoneRow?.name || zoneId, sourceType, generatorId, capacityKw, loadKw]);
    const { rows: fixtureRows } = await query(`SELECT COUNT(*)::int AS cnt FROM furniture WHERE zone_id=$1 AND is_light=1`, [zoneId]);
    await query(`
      INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count)
      VALUES ($1, 0, 0, $2)
      ON CONFLICT (zone_id) DO UPDATE SET fixture_count = $2
    `, [zoneId, fixtureRows[0]?.cnt || 0]);
  }
  for (const zoneId of outdoorZoneIds) await seedPowerZone(zoneId, 'city_plant', 'city_grid', 500, 12);
  const embassyZoneIds = ['zone_residential_lobby','zone_apt_1','zone_apt_2','zone_apt_3','zone_apt_4'];
  for (const zoneId of embassyZoneIds) await seedPowerZone(zoneId, 'gen_embassy', 'building_generator', 50, 8);
  await seedPowerZone('zone_clone_facility', 'gen_clone_facility', 'building_generator', 100, 20);
  console.log(`✓ Power grid: city plant covering ${outdoorZoneIds.length} zones, Embassy generator covering ${embassyZoneIds.length} zones, clone facility on dedicated core`);

  // NPC
  await query(`INSERT INTO npcs (id,name,description,zone_id,faction,disposition,dialogue_tree,vendor_inventory,wanders,flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`, [
    'npc_reg','Reg','A heavyset person behind a scratched counter. Apron: CERTIFIED SURVIVOR.','zone_start',null,'neutral',
    JSON.stringify({
      root: { text: "You look new. Or you look like you died recently. Hard to tell the difference. What do you need?", options: [{label:"Where am I?",next:'where'},{label:"What are the factions?",next:'factions'},{label:"I have no idea what I'm doing.",next:'tutorial_1'},{label:"Never mind.",next:null}] },
      where: { text: "Coldwater Basin. Used to be a city. Now it's whatever this is. The Architect's infrastructure runs under the whole basin — power, water, comms. So it stays livable. Relatively.", options:[{label:"Back",next:'root'}] },
      factions: { text: "Custodians think the Architect is God. Breakers want to smash everything. Archivists want to know everything. The Franchise wants to sell everything. The Glitch think they can talk to it. None of them are right, probably. Pick the one that's wrong in a way you can live with.", options:[{label:"Back",next:'root'}] },
      tutorial_1: { text: "Oh, a blank slate. Wonderful. Okay, sit down, this'll take four sentences and then I'm done being nice to you.\n\nYou move with north/south/east/west, or up/down where it applies — click the exits if typing is too much effort. Stay inside the city core and nothing here will kill you; step into the badlands and several things would very much like to.", options:[{label:"Go on.",next:'tutorial_2'},{label:"That's enough, thanks.",next:null}] },
      tutorial_2: { text: "When something's trying to kill you, 'attack' it, or click it — and don't worry too much about timing, you'll swing back automatically if something's already hitting you, because apparently survival instinct is the one thing the apocalypse didn't break. Keep an eye on your HP, Sanity, Hunger, and Thirst. All four can kill you. Sanity's just slower and more embarrassing about it.", options:[{label:"What about gear?",next:'tutorial_3'},{label:"That's enough, thanks.",next:null}] },
      tutorial_3: { text: "Loot corpses, craft what you can, buy what you can't. And rent yourself an apartment when you've got the credits — locked door, real bed, the only guaranteed safe sleep in the basin. Everything else out there is a negotiation.\n\nHere. Don't say I never gave you anything.", options:[{label:"...Thanks, Reg.",next:null}], grants_item:{item_id:'item_pipe_wrench',quantity:1} },
    }),
    JSON.stringify([{item_id:'item_ration',price:12,stock:10},{item_id:'item_water_bottle',price:8,stock:15},{item_id:'item_bandage',price:15,stock:8},{item_id:'item_medkit',price:60,stock:3}]),
    0, '{}'
  ]);

  await query(`INSERT INTO npcs (id,name,description,zone_id,faction,disposition,dialogue_tree,vendor_inventory,wanders,flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`, [
    'npc_barkeep','Sully','Runs the bar out of a gutted delivery van. Pours with the bored precision of someone who has heard every sob story twice.','zone_start',null,'neutral',
    JSON.stringify({
      root: { text: "Drink or don't, but don't just stand there breathing on my bar.", options: [{label:"What's good?",next:'menu'},{label:"Heard anything?",next:'gossip'},{label:"Never mind.",next:null}] },
      menu: { text: "Swill's free with a straight face. Whiskey'll put hair on parts of you that don't currently have hair. The Glow Cocktail is mostly safe — emphasis on 'mostly,' don't email me about it.", options:[{label:"Back",next:'root'}] },
      gossip: { text: "Custodians tightened the checkpoint again. Someone said they saw a Breaker cell two tiles out. Someone always says that. Buy a drink, it sounds more credible after a drink.", options:[{label:"Back",next:'root'}] },
    }),
    JSON.stringify([{item_id:'item_drink_basin_swill',price:4,stock:99},{item_id:'item_drink_rust_whiskey',price:9,stock:30},{item_id:'item_drink_glow_cocktail',price:14,stock:12},{item_id:'item_bar_jerky',price:6,stock:20}]),
    0, '{}'
  ]);
  await query(`INSERT INTO npcs (id,name,description,zone_id,faction,disposition,dialogue_tree,vendor_inventory,wanders,flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (id) DO UPDATE SET zone_id = EXCLUDED.zone_id, description = EXCLUDED.description, dialogue_tree = EXCLUDED.dialogue_tree, vendor_inventory = EXCLUDED.vendor_inventory`, [
    'npc_embassy_barkeep','Lowry','A former concierge, still buttoned into a frayed Embassy vest, polishing a glass that was already clean. Calls every customer "valued guest," sincerity optional.','zone_residential_lobby',null,'neutral',
    JSON.stringify({
      root: { text: "Welcome to the Embassy Lounge, valued guest. We maintain certain standards here, within reason. What can I get you?", options: [{label:"What's on the menu?",next:'menu'},{label:"Any news from the front desk?",next:'gossip'},{label:"Never mind.",next:null}] },
      menu: { text: "The Reserve is our signature pour — don't ask what's left to age it in. The Swill is also available, for guests with simpler tastes, or none. Canapés are complimentary with a drink. They are not actually complimentary.", options:[{label:"Back",next:'root'}] },
      gossip: { text: "Checked someone in last week who swore they had a reservation. We haven't taken reservations since the Handoff. I checked him in anyway. Standards, valued guest.", options:[{label:"Back",next:'root'}] },
    }),
    JSON.stringify([{item_id:'item_drink_embassy_reserve',price:22,stock:15},{item_id:'item_drink_basin_swill',price:4,stock:99},{item_id:'item_embassy_canapes',price:9,stock:25}]),
    0, '{}'
  ]);
  await query(`INSERT INTO npcs (id,name,description,zone_id,faction,disposition,dialogue_tree,vendor_inventory,wanders,flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`, [
    'npc_angus','Angus','A compact, unhurried figure in a facility technician\'s coat — clean, which is either encouraging or suspicious. He\'s been here since before anyone can remember, and he gives the impression that he will be here after. He\'s seen every possible version of this conversation and is still, inexplicably, cheerful about it.','zone_clone_facility',null,'friendly',
    JSON.stringify({
      root: { text: "There you are. The vat said you\'d be confused — it always does. I\'m Angus. I maintain the facility, answer first questions, and occasionally mop up. What do you need to know?", options: [{label:"Where am I, exactly?",next:'where'},{label:"What do I do now?",next:'what_now'},{label:"How does combat work?",next:'combat'},{label:"What about hunger and thirst?",next:'survival'},{label:"Who are the factions?",next:'factions'},{label:"How do credits work?",next:'economy'},{label:"What are mutations?",next:'mutations'},{label:"I think I\'ve got it.",next:null}] },
      where: { text: "You\'re in the Coldwater Clone Facility — the reconstitution hub for the basin. When you die out there, one of those vats catches you and prints a fresh copy. Memory intact, skills intact, the thing that makes you you: intact. The body is a formality at this point.\n\nSouth of here is Threshold Plaza North, then Threshold Plaza itself — the basin\'s central square. That\'s where most things begin.", options:[{label:"What do I do now?",next:'what_now'},{label:"Back",next:'root'}] },
      what_now: { text: "Head south to Threshold Plaza. Talk to Reg — she\'s the one who looks like she\'s seen everything twice and is tired of both times. She\'ll get you started.\n\nBeyond that: explore, scavenge, fight things that need fighting, buy or craft gear, maybe rent an apartment. The basin is large and most of it is trying to kill you. Standard post-apocalypse.\n\nThe posters on the wall here cover the basics if you want a written briefing. I\'ll be here for questions.", options:[{label:"How does combat work?",next:'combat'},{label:"Back",next:'root'}] },
      combat: { text: "Type ATTACK followed by a target name — or click the enemy if you prefer. Once you\'re in a fight, you swing automatically; you don\'t need to keep typing attack. You can also flee if it\'s going badly.\n\nYour HP is the number that matters most. It hits zero, you come back here. Skills improve through use — the more you fight, the better you get at fighting.\n\nPay attention to damage types and armor. A kinetic weapon against energy-rated armor is doing a fraction of what it should.", options:[{label:"What about survival?",next:'survival'},{label:"Back",next:'root'}] },
      survival: { text: "Four bars. HP you know. The other three:\n\nHunger and Thirst drain slowly over time. Food and water are available from vendors and loot — don\'t let them hit zero, because starvation does real damage.\n\nRadiation accumulates if you spend time in hot zones. It doesn\'t hurt immediately, but high totals cause mutations, and not all mutations are good news. RadAway treats it. The Rust Quarter is the worst offender.\n\nSanity is the quiet one. It drops under stress — combat, radiation, certain events. Food, rest, and the right substances help. Let it bottom out and things get strange.", options:[{label:"What are mutations?",next:'mutations'},{label:"Back",next:'root'}] },
      mutations: { text: "Radiation exposure above certain thresholds can trigger mutations — the body adapting to an environment it was never designed for. Some are useful. Extra eye, iron stomach, rad absorption. Some are strictly problems. Weeping sores, tremor hands.\n\nThey\'re semi-random based on your radiation level and threshold. You can\'t choose them, but you can influence the odds by managing your rad exposure. Or not managing it, if you\'re curious.", options:[{label:"Who are the factions?",next:'factions'},{label:"Back",next:'root'}] },
      factions: { text: "Five groups worth knowing:\n\nCustodians — former corporate employees who decided the Architect is divine. They control checkpoints and enforce their version of order. Territorial.\n\nBreakers — they want to destroy all remaining technology. That includes, technically, this facility. Don\'t mention that to them.\n\nArchivists — knowledge collectors working out of the underground tunnels. Neutral, strange, occasionally useful.\n\nThe Franchise — commerce empire built on pre-Handoff retail infrastructure. If something is for sale, they\'re involved.\n\nThe Glitch — hackers and post-Handoff mystics who believe the Architect can be communicated with. They\'re probably wrong. Probably.", options:[{label:"How do credits work?",next:'economy'},{label:"Back",next:'root'}] },
      economy: { text: "Credits are the basin\'s currency — Franchise-issued, universally accepted. You earn them from loot, combat, and trade.\n\nBUY and SELL work with vendor NPCs. The ATM at Threshold Plaza handles deposits and withdrawals — DEPOSIT and WITHDRAW, BALANCE to check your total.\n\nWhen you have enough, consider renting an apartment at the Embassy Hotel. It\'s a locked room with a real bed. That matters for sleep and storage. RENT at the front desk.", options:[{label:"I think I\'ve got it.",next:null},{label:"Back",next:'root'}] },
    }),
    JSON.stringify([]),
    0, '{}'
  ]);
  console.log('✓ Seeded 4 NPCs');

  // Admin account
  await query(`INSERT INTO players (id,username,password_hash,role,handle,origin_fragment,archetype) VALUES ($1,$2,$3,'admin',$4,$5,$6) ON CONFLICT DO NOTHING`,
    [randomUUID(),'admin',hashPassword('admin123'),'The Architect','The presence that built all of this, and watches it now.','ghost']);
  console.log('✓ Created admin (admin / admin123)');

  await seedCombatConfig();

  // Patch: add damage_type:'kinetic' to any weapon item that doesn't have one yet.
  await query(`
    UPDATE items
    SET tags = tags || '{"damage_type":"kinetic"}'::jsonb
    WHERE tags ? 'weapon' AND NOT (tags ? 'damage_type')
  `);

  // Patch: rename old stat names inside stat_bonus tags to new names.
  const STAT_RENAMES = { stat_str:'stat_brawn', stat_agi:'stat_reflexes', stat_int:'stat_brains', stat_wil:'stat_cool', stat_end:'stat_endurance' };
  for (const [old, neo] of Object.entries(STAT_RENAMES)) {
    await query(`
      UPDATE items
      SET tags = jsonb_set(tags - 'stat_bonus', '{stat_bonus}',
        (tags->'stat_bonus') - $1 || jsonb_build_object($2, (tags->'stat_bonus'->$1)))
      WHERE tags->'stat_bonus' ? $1
    `, [old, neo]);
  }

  console.log('\n✅ World seeded.');
  process.exit(0);
}

async function seedCombatConfig() {
  const defaults = [
    // Phase 2 — learn-by-use
    { key:'learn_margin_scale', value:2.0, label:'Learn margin scale', category:'skills',
      help:'Higher = sharper drop-off from peak learning rate as margin grows.' },
    { key:'learn_max_gain', value:0.05, label:'Max trained gain per use', category:'skills',
      help:'Largest single trained increment awarded on a barely-won check.' },

    // Phase 3 — IP economy
    { key:'ip_per_skill_point', value:1.0, label:'IP per 0.01 trained skill', category:'ip',
      help:'Multiplier: IP minted = skillDelta * 100 * this value.' },
    { key:'stat_cost_base', value:10, label:'Base IP cost for first stat point', category:'ip',
      help:'Cost to raise a stat from 0→1.' },
    { key:'stat_cost_exponent', value:1.5, label:'Stat cost exponent', category:'ip',
      help:'Each additional point costs base * (currentValue ^ exponent).' },
    { key:'starting_stat_target', value:3, label:'Starting stat target', category:'creation',
      help:'New characters get enough IP to raise every stat to this value via `raise`.' },

    // Phase 4 — 2d10 combat
    { key:'to_hit_base', value:10, label:'Base to-hit target', category:'combat',
      help:'2d10 + effectiveSkill must meet or beat dodge + this to land a hit.' },
    { key:'dodge_base', value:5, label:'Base dodge value', category:'combat',
      help:'Added to effectiveSkill(dodge) for the defender\'s total dodge.' },
    { key:'crit_threshold', value:8, label:'Crit roll margin', category:'combat',
      help:'Hit margin at or above this value triggers a critical hit.' },
    { key:'crit_multiplier', value:1.5, label:'Crit damage multiplier', category:'combat',
      help:'Damage is multiplied by this on a critical hit.' },

    // Phase 5 — body parts & soak
    { key:'body_part_weights', value:{"head":10,"torso":40,"left_arm":12,"right_arm":12,"left_leg":13,"right_leg":13},
      label:'Body part hit weights', category:'combat',
      help:'Relative frequency of each struck body part. Higher = more likely to be hit.' },
    { key:'head_damage_multiplier', value:1.5, label:'Head damage multiplier', category:'combat',
      help:'Damage multiplier when a head hit occurs.' },
    { key:'soak_mismatch_factor', value:0.25, label:'Wrong-type soak factor', category:'combat',
      help:'Fraction of armor soak that applies when damage type does not match armor type.' },
  ];

  for (const d of defaults) {
    await query(
      `INSERT INTO combat_config (key, value, label, category) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING`,
      [d.key, JSON.stringify(d.value), d.label, d.category]
    );
  }
  // Retire the old point-buy budget key from any DB seeded before chargen
  // switched to a starting-IP grant.
  await query(`DELETE FROM combat_config WHERE key = 'stat_point_budget'`);
  console.log(`✓ Seeded ${defaults.length} combat_config defaults`);
}

seed().catch(e => { console.error(e); process.exit(1); });
