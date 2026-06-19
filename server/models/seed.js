import { query } from './db.js';
import { randomUUID, createHash } from 'crypto';

const hashPassword = pw => createHash('sha256').update(pw).digest('hex');

async function seed() {
  // Zones
  const zones = [
    { id: 'zone_start', name: 'The Threshold', description: 'A cracked concrete plaza that used to be a transit hub. The LED departure boards still flicker, cycling through destinations that no longer exist. WELCOME TO COLDWATER BASIN reads a banner half-eaten by something. Below it, someone has spraypainted: POPULATION: SURVIVING. The air smells like ozone and old fast food.', danger_rating: 'safe', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { north: 'zone_market', east: 'zone_outskirts' }, ambient_events: ['A drone hums overhead, its chassis stenciled with a faded corporate logo you half-recognize.', 'Somewhere in the plaza, a speaker plays a jingle for a fast food chain. Thirty seconds in, it loops.', 'A ragged NPC catches your eye and immediately looks away. Everyone here has learned not to be interesting.', 'The departure board flickers: COLDWATER → DENVER → SALT LAKE → [SIGNAL LOST]'] },
    { id: 'zone_market', name: 'The Franchise Strip', description: 'A stretch of pre-Handoff retail storefronts that have been repurposed, colonized, and argued over for years. The bones are familiar — big box store skeletons, drive-through lanes now used as livestock pens — but everything has been retrofitted for survival.', danger_rating: 'low', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { south: 'zone_start', north: 'zone_warehouse', west: 'zone_slums' }, ambient_events: ['A vendor shouts: "AUTHENTIC PRE-HANDOFF CANNED GOODS. ONLY SLIGHTLY EXPIRED."', 'Two people argue loudly about whether the Architect controls the weather. Neither sounds sure.'] },
    { id: 'zone_slums', name: 'The Sprawl', description: 'Dense, vertical, and loud. Pre-Handoff apartment complexes have been stacked with improvised floors. The streets below are narrow tunnels of laundry lines and extension cords.', danger_rating: 'medium', pvp_enabled: 1, radiation_level: 0, is_safe_zone: 0, exits: { east: 'zone_market', north: 'zone_ruins', down: 'zone_tunnels' }, ambient_events: ['Something crashes several floors above. Then laughter.', 'A wall-mounted screen plays a looping corporate training video on conflict resolution.'] },
    { id: 'zone_outskirts', name: 'The Rust Quarter', description: 'Industrial wasteland at the edge of the basin. Enormous processing facilities stand half-collapsed. The ground is stained in colors that don\'t occur in nature.', danger_rating: 'medium', pvp_enabled: 1, radiation_level: 15, is_safe_zone: 0, exits: { west: 'zone_start', north: 'zone_ruins', east: 'zone_deep_waste' }, ambient_events: ['A Geiger counter ticks somewhere nearby. The rhythm is wrong for the environment.', 'You find a paycheck stub from a company that no longer exists.'] },
    { id: 'zone_ruins', name: 'Old Coldwater', description: 'What remains of the actual city. Glass and rebar and the occasional wall of a building that still looks like it meant something once. At the center, the old city hall stands largely untouched — the Architect\'s infrastructure runs through its foundation.', danger_rating: 'high', pvp_enabled: 1, radiation_level: 5, is_safe_zone: 0, exits: { south: 'zone_slums', west: 'zone_outskirts', north: 'zone_architect_shadow' }, ambient_events: ['The city hall\'s windows glow faint blue. They always do. Nobody goes in.', 'A dog watches you from a pile of rubble. It doesn\'t seem scared. That\'s somehow worse.'] },
    { id: 'zone_tunnels', name: 'The Under', description: 'Pre-Handoff subway tunnels, now home to the Archivists. Emergency lighting casts everything amber. The walls are dense with salvaged text — newspaper fragments, printed articles, handwritten notes.', danger_rating: 'medium', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { up: 'zone_slums', east: 'zone_archivist_vault' }, ambient_events: ['Someone is typing, fast, somewhere in the dark.', 'A train horn sounds in the distance. There are no trains.'] },
    { id: 'zone_warehouse', name: 'The Loading Bay', description: 'A vast warehouse complex that The Franchise faction uses as a distribution hub. Everything here has a SKU. Everything here is for sale.', danger_rating: 'low', pvp_enabled: 0, radiation_level: 0, is_safe_zone: 1, exits: { south: 'zone_market' }, ambient_events: ['"CUSTOMER SATISFACTION IS OUR PRIORITY" plays from overhead speakers. The voice sounds increasingly uncertain.'] },
    { id: 'zone_deep_waste', name: 'The Bleed', description: 'Past the Rust Quarter, the ground itself seems wrong. Pools of iridescent liquid. Creatures that have adapted to whatever the Architect\'s infrastructure leaks out here. High radiation. High lethality.', danger_rating: 'lethal', pvp_enabled: 1, radiation_level: 60, is_safe_zone: 0, exits: { west: 'zone_outskirts' }, ambient_events: ['Something large moves in the liquid pool to your east. The liquid moves back.', 'The Geiger counter stops ticking. This is not good news.'] },
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

  // Zone spawns
  const spawns = [
    ['zone_outskirts','enemy_scav',3,80,180],['zone_outskirts','enemy_feral_dog',2,60,120],
    ['zone_slums','enemy_scav',2,70,240],['zone_ruins','enemy_scav',3,60,200],
    ['zone_ruins','enemy_custodian_enforcer',2,40,300],['zone_ruins','enemy_architect_drone',1,20,600],
    ['zone_deep_waste','enemy_rad_mutant',4,90,150],['zone_deep_waste','enemy_architect_drone',2,30,400],
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
    [randomUUID(),'admin',hashPassword('admin123'),'The Admin','Someone who built all of this.','ghost']);
  console.log('✓ Created admin (admin / admin123)');
  console.log('\n✅ World seeded.');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
