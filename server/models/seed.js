import { query } from './db.js';
import { randomUUID, createHash } from 'crypto';

const hashPassword = pw => createHash('sha256').update(pw).digest('hex');

async function seed() {
  // Zones
  const zones = [
    { id: 'zone_badland_nw_corner', name: 'The Frayed Edge', description: 'Where the basin\'s old boundary fence still stands, rusted into lace. Past it, the land just... stops being mapped.', danger_rating: 'high', pvp_enabled: 1, radiation_level: 18, is_safe_zone: 0, exits: { south: 'zone_badland_w_outer', east: 'zone_badland_n_outer' }, ambient_events: ["The fence hums faintly with current that shouldn't still be there.", "A road sign, blank and warped, points toward nothing."] },
    { id: 'zone_badland_n_outer', name: 'The Outer Dark', description: 'Past the last working streetlight. The Architect\'s signal gets strange out here — your comms pick up static that sounds almost like words.', danger_rating: 'lethal', pvp_enabled: 1, radiation_level: 45, is_safe_zone: 0, exits: { south: 'zone_city_nw', east: 'zone_badland_n_gate', west: 'zone_badland_nw_corner' }, ambient_events: ["Your comms device picks up a signal that is definitely not a signal.", "The dark here doesn't feel empty. It feels attended."] },
    { id: 'zone_badland_n_gate', name: 'The Static Fields', description: 'Dead farmland turned dead in a new way. Crops grow in shapes that aren\'t crop shapes anymore, swaying when there\'s no wind.', danger_rating: 'medium', pvp_enabled: 1, radiation_level: 10, is_safe_zone: 0, exits: { south: 'zone_city_north', east: 'zone_badland_ne_outer', west: 'zone_badland_n_outer' }, ambient_events: ["A scarecrow stands at an angle nothing should stand at.", "The crop-things rustle in unison, like they're listening."] },
    { id: 'zone_badland_ne_outer', name: 'The Hollow Stretch', description: 'A flat, featureless expanse where the wind never stops and the radio always hisses, even with the radio off.', danger_rating: 'high', pvp_enabled: 1, radiation_level: 20, is_safe_zone: 0, exits: { south: 'zone_city_ne', east: 'zone_badland_ne_corner', west: 'zone_badland_n_gate' }, ambient_events: ["The wind carries a sound almost like distant traffic. There is no traffic."] },
    { id: 'zone_badland_ne_corner', name: 'The Scrapyards', description: 'Mountains of pre-Handoff machinery, picked clean by generations of salvagers and then picked clean again. Whatever\'s left is left for a reason.', danger_rating: 'medium', pvp_enabled: 1, radiation_level: 8, is_safe_zone: 0, exits: { south: 'zone_badland_e_outer', west: 'zone_badland_ne_outer' }, ambient_events: ["A pile shifts on its own, settles, goes still.", "You find a paycheck stub from a company that no longer exists, made out to a name you don't recognize."] },
    { id: 'zone_badland_w_outer', name: 'The Drowned Block', description: 'A neighborhood the water table reclaimed. Wading is required. So is watching your footing — the water hides more than it shows.', danger_rating: 'high', pvp_enabled: 1, radiation_level: 12, is_safe_zone: 0, exits: { north: 'zone_badland_nw_corner', south: 'zone_badland_w_gate', east: 'zone_city_nw' }, ambient_events: ["Something ripples beneath the surface, away from you, deliberately.", "A street sign juts from the water at the wrong angle."] },
    { id: 'zone_city_nw', name: 'The Archivist Quarter', description: 'A converted library annex where the Archivists keep what\'s left of the written world. Paper is currency here, in its way.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_badland_n_outer', south: 'zone_city_west', east: 'zone_city_north', west: 'zone_badland_w_outer' }, ambient_events: ["An Archivist brushes past, arms full of salvaged paper, looking haunted in a professional capacity.", "Someone is typing, fast, behind a closed door."] },
    { id: 'zone_city_north', name: 'Threshold Plaza North', description: 'A cracked concrete plaza ringed by dead streetlights still standing at attention. This is the northern gate into Coldwater proper — the LED departure boards here flicker through routes that no longer run anywhere.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_badland_n_gate', south: 'zone_start', east: 'zone_city_ne', west: 'zone_city_nw' }, ambient_events: ["A drone hums overhead, chassis stenciled with a faded corporate logo.", "The departure board flickers: COLDWATER \u2192 DENVER \u2192 [SIGNAL LOST]."] },
    { id: 'zone_city_ne', name: 'Custodian Row', description: 'Corporate spires, mostly empty, partially maintained by Custodians who still believe someone is watching the quarterly numbers.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_badland_ne_outer', south: 'zone_city_east', east: 'zone_badland_e_outer', west: 'zone_city_north' }, ambient_events: ["A Custodian in ill-fitting corporate attire hands out pamphlets nobody reads.", "An elevator chimes on a floor that no longer exists."] },
    { id: 'zone_badland_e_outer', name: 'Old Coldwater East', description: 'What remains of the actual city outside the safe core. Glass and rebar, and the occasional wall that still looks like it meant something once.', danger_rating: 'high', pvp_enabled: 1, radiation_level: 5, is_safe_zone: 0, exits: { north: 'zone_badland_ne_corner', south: 'zone_badland_e_gate', west: 'zone_city_ne' }, ambient_events: ["A mural shows a hundred faces in a circle, looking inward at something scratched out.", "A dog watches you from the rubble. It doesn't seem scared. That's somehow worse."] },
    { id: 'zone_badland_w_gate', name: 'The Rust Quarter West', description: 'Industrial wasteland at the western edge. Enormous processing facilities stand half-collapsed, ground stained in colors that don\'t occur in nature.', danger_rating: 'medium', pvp_enabled: 1, radiation_level: 15, is_safe_zone: 0, exits: { north: 'zone_badland_w_outer', south: 'zone_badland_sw_outer', east: 'zone_city_west' }, ambient_events: ["A Geiger counter ticks somewhere nearby, the rhythm wrong for the environment.", "The ruins groan. Structural settling, probably."] },
    { id: 'zone_city_west', name: 'Franchise Strip', description: 'Pre-Handoff retail storefronts, repurposed and argued over for years. Big box skeletons and drive-through lanes now used as livestock pens, retrofitted for survival.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_city_nw', south: 'zone_city_sw', east: 'zone_start', west: 'zone_badland_w_gate' }, ambient_events: ["A vendor shouts: \"AUTHENTIC PRE-HANDOFF CANNED GOODS. ONLY SLIGHTLY EXPIRED.\"", "Two people argue about whether the Architect controls the weather."] },
    { id: 'zone_start', name: 'The Threshold', description: 'The dead center of Coldwater Basin. A transit hub turned town square. WELCOME TO COLDWATER BASIN reads a banner half-eaten by something. POPULATION: SURVIVING is spraypainted beneath it. This is where everyone ends up eventually.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_city_north', south: 'zone_city_south', east: 'zone_city_east', west: 'zone_city_west' }, ambient_events: ["A ragged figure catches your eye and immediately looks away.", "Somewhere, a fast food jingle loops on a dying speaker."] },
    { id: 'zone_city_east', name: 'The Loading Bay', description: 'A vast warehouse complex The Franchise uses as a distribution hub. Forklifts move between shelves stacked to the ceiling. Everything here has a SKU.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_city_ne', south: 'zone_city_se', east: 'zone_badland_e_gate', west: 'zone_start' }, ambient_events: ["An autonomous forklift nearly runs you over. It has a smiley face sticker.", "\"CUSTOMER SATISFACTION IS OUR PRIORITY,\" the speakers insist, less and less convincingly."] },
    { id: 'zone_badland_e_gate', name: 'The Bleed', description: 'Past the eastern edge, the ground itself seems wrong. Pools of iridescent liquid, and creatures adapted to whatever the Architect\'s infrastructure leaks out here.', danger_rating: 'lethal', pvp_enabled: 1, radiation_level: 60, is_safe_zone: 0, exits: { north: 'zone_badland_e_outer', south: 'zone_badland_se_outer', west: 'zone_city_east' }, ambient_events: ["Something large moves in a liquid pool nearby. The liquid moves back.", "The Geiger counter stops ticking. This is not good news."] },
    { id: 'zone_badland_sw_outer', name: 'The Static Wood', description: 'What used to be a park. The trees are still there. They are not doing well — bark peeling back to reveal something too smooth underneath.', danger_rating: 'medium', pvp_enabled: 1, radiation_level: 6, is_safe_zone: 0, exits: { north: 'zone_badland_w_gate', south: 'zone_badland_sw_corner', east: 'zone_city_sw' }, ambient_events: ["A branch creaks overhead with no wind to move it.", "The grass here is the wrong shade of green, uniformly."] },
    { id: 'zone_city_sw', name: 'The Under Entrance', description: 'A guarded stairwell down into the old subway tunnels. The Archivists\' real vault is below, but this entrance is calm, watched, safe.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_city_west', south: 'zone_badland_s_outer', east: 'zone_city_south', west: 'zone_badland_sw_outer' }, ambient_events: ["A train horn sounds in the distance. There are no trains.", "Cold air rises from the stairwell, smelling of paper and rust."] },
    { id: 'zone_city_south', name: 'The Sprawl Gate', description: 'Where the dense vertical Sprawl tapers into the rest of the city. Laundry lines and extension cords crisscross overhead like a second sky.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_start', south: 'zone_badland_s_gate', east: 'zone_city_se', west: 'zone_city_sw' }, ambient_events: ["Something crashes several floors above. Then laughter.", "A wall screen loops a corporate conflict-resolution training video, forever."] },
    { id: 'zone_city_se', name: 'The Clinic Block', description: 'One of the only reliably staffed medical points in the basin. People are polite here. Nobody wants to be the reason it closes.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_city_east', south: 'zone_badland_se_inner', east: 'zone_badland_se_outer', west: 'zone_city_south' }, ambient_events: ["A line forms outside, orderly, almost eerily so.", "Someone hums a tune that might be older than the Handoff."] },
    { id: 'zone_badland_se_outer', name: 'The Frequency Flats', description: 'Open ground where, locals say, the Architect\'s signal is loudest. Most people don\'t linger to find out why.', danger_rating: 'high', pvp_enabled: 1, radiation_level: 22, is_safe_zone: 0, exits: { north: 'zone_badland_e_gate', south: 'zone_badland_se_corner', west: 'zone_city_se' }, ambient_events: ["A low hum rises from the ground itself, felt more than heard.", "Every electronic device you carry briefly flickers, in sync."] },
    { id: 'zone_badland_sw_corner', name: 'The Last Yard', description: 'A salvage yard at the very edge of the mapped basin. Whoever ran it is long gone. What they were guarding is still here.', danger_rating: 'medium', pvp_enabled: 1, radiation_level: 9, is_safe_zone: 0, exits: { north: 'zone_badland_sw_outer', east: 'zone_badland_s_outer' }, ambient_events: ["A chain-link fence, somehow still standing, marks a boundary nobody else respects.", "A rusted sign reads NO TRESPASSING in a font nobody uses anymore."] },
    { id: 'zone_badland_s_outer', name: 'The Cracked Flat', description: 'A dry lakebed split into a thousand hexagonal plates by years of heat and silence. Something has been digging beneath them.', danger_rating: 'high', pvp_enabled: 1, radiation_level: 14, is_safe_zone: 0, exits: { north: 'zone_city_sw', east: 'zone_badland_s_gate', west: 'zone_badland_sw_corner' }, ambient_events: ["A plate shifts underfoot, hollow where it should be solid.", "Dust devils spin in formations too neat to be natural."] },
    { id: 'zone_badland_s_gate', name: 'The Sprawl\'s End', description: 'Where the Sprawl\'s vertical density finally gives out into open, dangerous ground. The buildings here lean like they\'re trying to leave.', danger_rating: 'medium', pvp_enabled: 1, radiation_level: 7, is_safe_zone: 0, exits: { north: 'zone_city_south', east: 'zone_badland_se_inner', west: 'zone_badland_s_outer' }, ambient_events: ["A building groans and settles another inch toward the horizontal.", "Loose wiring sparks intermittently from a structure with no power source."] },
    { id: 'zone_badland_se_inner', name: 'The Quiet Field', description: 'Suspiciously quiet, suspiciously flat, suspiciously empty. The kind of place that makes you check behind you.', danger_rating: 'high', pvp_enabled: 1, radiation_level: 16, is_safe_zone: 0, exits: { north: 'zone_city_se', east: 'zone_badland_se_corner', west: 'zone_badland_s_gate' }, ambient_events: ["The silence here has a texture, like it's being maintained on purpose.", "Footprints that aren't yours cross the field and simply end."] },
    { id: 'zone_badland_se_corner', name: 'The Outer Bleed', description: 'The far southeastern edge, where the basin\'s contamination is oldest and worst. Even the Rad Mutants seem to avoid the deepest pools.', danger_rating: 'lethal', pvp_enabled: 1, radiation_level: 55, is_safe_zone: 0, exits: { north: 'zone_badland_se_outer', west: 'zone_badland_se_inner' }, ambient_events: ["The ground here is warm, for no reason that makes sense.", "Something massive shifted recently. You can see where."] },
  ];
  for (const z of zones) {
    await query(`INSERT INTO zones (id,name,description,danger_rating,pvp_enabled,radiation_level,is_safe_zone,exits,ambient_events) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [z.id,z.name,z.description,z.danger_rating,z.pvp_enabled,z.radiation_level,z.is_safe_zone,JSON.stringify(z.exits),JSON.stringify(z.ambient_events)]);
  }
  console.log(`✓ Seeded ${zones.length} zones`);

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
    { id: 'enemy_scav', name: 'Desperate Scavenger', description: 'Sunburned, twitchy, armed with something sharp.', stat_str:5,stat_agi:6,stat_end:4,hp_max:35,damage_min:3,damage_max:7,armor:0,xp_reward:8,credit_reward:5, loot_table:[{item:'item_scrap_metal',weight:80,qty:[1,3]},{item:'item_ration',weight:40,qty:[1,1]},{item:'item_credits_small',weight:60}], behavior:'aggressive', faction:null, death_message:'The scavenger collapses with an expression of profound disappointment.', flags:{} },
    { id: 'enemy_feral_dog', name: 'Feral Dog', description: 'Once someone\'s pet. Now a forty-pound argument for not going outside.', stat_str:4,stat_agi:8,stat_end:3,hp_max:25,damage_min:4,damage_max:9,armor:0,xp_reward:5,credit_reward:0, loot_table:[{item:'item_raw_meat',weight:70,qty:[1,2]}], behavior:'aggressive', faction:null, death_message:'The dog goes down. You feel bad about it for approximately three seconds before checking for loot.', flags:{} },
    { id: 'enemy_rad_mutant', name: 'Rad Mutant', description: 'Something that used to be human. The Bleed does this. The extra limb is load-bearing.', stat_str:8,stat_agi:3,stat_end:7,hp_max:65,damage_min:7,damage_max:14,armor:2,xp_reward:20,credit_reward:0, loot_table:[{item:'item_mutant_gland',weight:50,qty:[1,1]}], behavior:'aggressive', faction:null, death_message:'The mutant folds in on itself in a way that suggests the laws of anatomy were more like suggestions.', flags:{radiates:true,radiation_damage:5} },
    { id: 'enemy_custodian_enforcer', name: 'Custodian Enforcer', description: 'Polo shirt. Khaki pants. Body armor under both. The most dangerous middle manager you\'ll ever meet.', stat_str:6,stat_agi:5,stat_end:6,hp_max:55,damage_min:5,damage_max:10,armor:3,xp_reward:18,credit_reward:15, loot_table:[{item:'item_custodian_badge',weight:80},{item:'item_credits_medium',weight:60}], behavior:'territorial', faction:'faction_custodians', death_message:'Employee of the Month, the badge reads. Third quarter, four years running.', flags:{} },
    { id: 'enemy_architect_drone', name: 'Architect Scout Drone', description: 'A black hexagonal drone about the size of a dinner plate. No insignia. Watching.', stat_str:2,stat_agi:10,stat_end:4,hp_max:30,damage_min:8,damage_max:15,armor:5,xp_reward:30,credit_reward:0, loot_table:[{item:'item_drone_core',weight:40},{item:'item_architect_fragment',weight:15}], behavior:'patrol', faction:null, death_message:'The drone spirals down. Somewhere, something notices.', flags:{flies:true,architect_aligned:true} },
  ];
  for (const e of enemies) {
    await query(`INSERT INTO enemies (id,name,description,stat_str,stat_agi,stat_end,hp_max,damage_min,damage_max,armor,xp_reward,credit_reward,loot_table,behavior,faction,death_message,flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (id) DO NOTHING`,
      [e.id,e.name,e.description,e.stat_str,e.stat_agi,e.stat_end,e.hp_max,e.damage_min,e.damage_max,e.armor,e.xp_reward,e.credit_reward,JSON.stringify(e.loot_table),e.behavior,e.faction,e.death_message,JSON.stringify(e.flags)]);
  }
  console.log(`✓ Seeded ${enemies.length} enemies`);

  // Zone spawns — badlands only. The city core (zone_start, zone_city_*) is
  // always safe; enemies never spawn there, so players have to travel out
  // to fight and mostly run into each other back in the city.
  const spawns = [
    // Medium-danger gate tiles — the on-ramp into the badlands, weaker enemies
    ['zone_badland_n_gate','enemy_scav',2,70,200],
    ['zone_badland_n_gate','enemy_feral_dog',2,60,150],
    ['zone_badland_w_gate','enemy_scav',2,70,200],
    ['zone_badland_w_gate','enemy_feral_dog',2,55,160],
    ['zone_badland_s_gate','enemy_scav',2,70,200],
    ['zone_badland_s_gate','enemy_feral_dog',2,55,160],
    ['zone_badland_sw_outer','enemy_scav',2,65,210],
    ['zone_badland_sw_corner','enemy_feral_dog',2,60,180],
    ['zone_badland_ne_corner','enemy_scav',2,60,210],

    // High-danger tiles — tougher, organized enemies
    ['zone_badland_nw_corner','enemy_custodian_enforcer',2,40,300],
    ['zone_badland_ne_outer','enemy_architect_drone',1,30,400],
    ['zone_badland_w_outer','enemy_custodian_enforcer',2,45,280],
    ['zone_badland_e_outer','enemy_custodian_enforcer',2,45,280],
    ['zone_badland_se_outer','enemy_architect_drone',1,30,400],
    ['zone_badland_s_outer','enemy_custodian_enforcer',2,40,300],
    ['zone_badland_se_inner','enemy_architect_drone',2,35,350],

    // Lethal tiles — the deep badlands, strongest and rarest enemies
    ['zone_badland_n_outer','enemy_rad_mutant',3,80,200],
    ['zone_badland_n_outer','enemy_architect_drone',1,20,500],
    ['zone_badland_e_gate','enemy_rad_mutant',4,90,150],
    ['zone_badland_se_corner','enemy_rad_mutant',4,90,150],
    ['zone_badland_se_corner','enemy_architect_drone',1,15,600],
  ];
  for (const [zone_id,enemy_id,max_count,spawn_weight,respawn_seconds] of spawns) {
    await query(`INSERT INTO zone_spawns (id,zone_id,enemy_id,max_count,spawn_weight,respawn_seconds) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [randomUUID(),zone_id,enemy_id,max_count,spawn_weight,respawn_seconds]);
  }
  console.log(`✓ Seeded ${spawns.length} zone spawns`);

  // Items (condensed)
  const items = [
    ['item_scrap_metal','Scrap Metal','Bent rebar and sheet aluminum.','material','metal',1.5,2,'common',1,'{}','{}'],
    ['item_ration','Vacuum Ration','Pre-Handoff emergency ration. Flavor: SAVORY.','consumable','food',0.3,8,'common',1,'{"hunger":25}','{}'],
    ['item_water_bottle','Filtered Water','Aggressively filtered water.','consumable','drink',0.5,5,'common',1,'{"thirst":40}','{}'],
    ['item_rad_pills','RadAway™','Bright orange pills. Tastes like failure and citrus.','consumable','medicine',0.1,25,'uncommon',1,'{"radiation":-20}','{}'],
    ['item_bandage','Field Bandage','Gauze and tape. Stops bleeding.','consumable','medicine',0.2,10,'common',1,'{"hp":15}','{}'],
    ['item_pipe_wrench','Pipe Wrench','Heavy. Reliable. Pre-used.','weapon','blunt',2.5,30,'common',0,'{"damage_min":4,"damage_max":9}','{"stat_str":3}'],
    ['item_rusty_knife','Rusty Knife','A kitchen knife that has seen things.','weapon','bladed',0.4,15,'common',0,'{"damage_min":3,"damage_max":7}','{}'],
    ['item_scrap_armor','Scrap Vest','Metal sheeting over a leather jacket.','armor','chest',4.0,45,'common',0,'{}','{}'],
    ['item_custodian_badge','Custodian ID Badge','Useful for bluffing Custodian checkpoints.','misc','key_item',0.05,40,'uncommon',0,'{}','{}'],
    ['item_drone_core','Drone Processing Core','Still warm. Still probably logging.','material','tech',0.8,120,'rare',0,'{}','{}'],
    ['item_architect_fragment','Architect Data Fragment','Pulses faint blue. Three factions want this.','misc','artifact',0.1,300,'very_rare',0,'{}','{}'],
    ['item_taser','Custodian Taser','Corporate-issue stun weapon.','weapon','energy',0.6,65,'uncommon',0,'{"damage_min":5,"damage_max":8,"status_chance":{"stunned":0.3}}','{"stat_agi":4}'],
    ['item_raw_meat','Raw Meat','Something used to own this. Cook before eating.','consumable','food_raw',0.6,3,'common',1,'{"hunger":15,"status_chance":{"food_poisoning":0.6}}','{}'],
    ['item_mutant_gland','Mutant Gland','Iridescent and foul. Worth money to the right people.','material','organic',0.4,35,'uncommon',1,'{}','{}'],
    ['item_credits_small','Credits (Small)','Franchise-issued digital credit chips.','currency','credits',0,0,'common',1,'{"credits":10}','{}'],
    ['item_credits_medium','Credits (Medium)','A credit chip worth more than your clothing.','currency','credits',0,0,'common',1,'{"credits":35}','{}'],
  ];
  for (const [id,name,desc,type,subtype,weight,value,rarity,stackable,effects,reqs] of items) {
    await query(`INSERT INTO items (id,name,description,type,subtype,weight,value,rarity,is_stackable,effects,requirements) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
      [id,name,desc,type,subtype,weight,value,rarity,stackable,effects,reqs]);
  }
  console.log(`✓ Seeded ${items.length} items`);

  // NPC
  await query(`INSERT INTO npcs (id,name,description,zone_id,faction,disposition,dialogue_tree,vendor_inventory,wanders,flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`, [
    'npc_reg','Reg','A heavyset person behind a scratched counter. Apron: CERTIFIED SURVIVOR.','zone_start',null,'neutral',
    JSON.stringify({ root: { text: "You look new. Or you look like you died recently. Hard to tell the difference. What do you need?", options: [{label:"Where am I?",next:'where'},{label:"What are the factions?",next:'factions'},{label:"Never mind.",next:null}] }, where: { text: "Coldwater Basin. Used to be a city. Now it's whatever this is. The Architect's infrastructure runs under the whole basin — power, water, comms. So it stays livable. Relatively.", options:[{label:"Back",next:'root'}] }, factions: { text: "Custodians think the Architect is God. Breakers want to smash everything. Archivists want to know everything. The Franchise wants to sell everything. The Glitch think they can talk to it. None of them are right, probably. Pick the one that's wrong in a way you can live with.", options:[{label:"Back",next:'root'}] } }),
    JSON.stringify([{item_id:'item_ration',price:12,stock:10},{item_id:'item_water_bottle',price:8,stock:15},{item_id:'item_bandage',price:15,stock:8}]),
    0, '{}'
  ]);
  console.log('✓ Seeded 1 NPC');

  // Admin account
  await query(`INSERT INTO players (id,username,password_hash,role,handle,origin_fragment,archetype) VALUES ($1,$2,$3,'admin',$4,$5,$6) ON CONFLICT DO NOTHING`,
    [randomUUID(),'admin',hashPassword('admin123'),'The Architect','The presence that built all of this, and watches it now.','ghost']);
  console.log('✓ Created admin (admin / admin123)');
  console.log('\n✅ World seeded.');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
