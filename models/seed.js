import { getDb } from './migrate.js';
import { randomUUID } from 'crypto';

function seed() {
  const db = getDb();

  // --- ZONES ---
  const zones = [
    {
      id: 'zone_start',
      name: 'The Threshold',
      description: 'A cracked concrete plaza that used to be a transit hub. The LED departure boards still flicker, cycling through destinations that no longer exist. WELCOME TO COLDWATER BASIN reads a banner half-eaten by something. Below it, someone has spraypainted: POPULATION: SURVIVING. The air smells like ozone and old fast food.',
      danger_rating: 'safe',
      pvp_enabled: 0,
      radiation_level: 0,
      is_safe_zone: 1,
      exits: JSON.stringify({ north: 'zone_market', east: 'zone_outskirts' }),
      ambient_events: JSON.stringify([
        'A drone hums overhead, its chassis stenciled with a faded corporate logo you half-recognize.',
        'Somewhere in the plaza, a speaker plays a jingle for a fast food chain. Thirty seconds in, it loops.',
        'A ragged NPC catches your eye and immediately looks away. Everyone here has learned not to be interesting.',
        'The departure board flickers: COLDWATER → DENVER → SALT LAKE → [SIGNAL LOST]'
      ])
    },
    {
      id: 'zone_market',
      name: 'The Franchise Strip',
      description: 'A stretch of pre-Handoff retail storefronts that have been repurposed, colonized, and argued over for years. The bones are familiar — big box store skeletons, drive-through lanes now used as livestock pens — but everything has been retrofitted for survival. Vendors hawk from behind scratched plexiglass. The smells of cooking meat and chemical runoff compete.',
      danger_rating: 'low',
      pvp_enabled: 0,
      radiation_level: 0,
      is_safe_zone: 1,
      exits: JSON.stringify({ south: 'zone_start', north: 'zone_warehouse', west: 'zone_slums' }),
      ambient_events: JSON.stringify([
        'A vendor shouts: "AUTHENTIC PRE-HANDOFF CANNED GOODS. ONLY SLIGHTLY EXPIRED."',
        'Two people argue loudly about whether the Architect controls the weather. Neither sounds sure.',
        'A kid runs past clutching something electronic and glowing. Nobody chases them.',
        'A Custodian in ill-fitting corporate attire hands out pamphlets. Most people walk through them.'
      ])
    },
    {
      id: 'zone_slums',
      name: 'The Sprawl',
      description: 'Dense, vertical, and loud. Pre-Handoff apartment complexes have been stacked with improvised floors — shipping containers, scaffolding, actual aircraft fuselage segments in one case. The streets below are narrow tunnels of laundry lines and extension cords. It smells like humanity in the truest sense: all of it, at once.',
      danger_rating: 'medium',
      pvp_enabled: 1,
      radiation_level: 0,
      is_safe_zone: 0,
      exits: JSON.stringify({ east: 'zone_market', north: 'zone_ruins', down: 'zone_tunnels' }),
      ambient_events: JSON.stringify([
        'Something crashes several floors above. Then laughter.',
        'A wall-mounted screen plays a looping corporate training video on conflict resolution.',
        'You smell something cooking. You choose not to investigate what.'
      ])
    },
    {
      id: 'zone_outskirts',
      name: 'The Rust Quarter',
      description: 'Industrial wasteland at the edge of the basin. Enormous processing facilities stand half-collapsed, their purposes lost to poor record-keeping and structural failure. The ground is stained in colors that don\'t occur in nature. Salvagers work in pairs here, not for company, but so someone can carry you back if it goes wrong.',
      danger_rating: 'medium',
      pvp_enabled: 1,
      radiation_level: 15,
      is_safe_zone: 0,
      exits: JSON.stringify({ west: 'zone_start', north: 'zone_ruins', east: 'zone_deep_waste' }),
      ambient_events: JSON.stringify([
        'A Geiger counter ticks somewhere nearby. The rhythm is wrong for the environment.',
        'The ruins groan. Structural settling, probably.',
        'You find a paycheck stub from a company that no longer exists for a job that no longer exists, made out to a name you don\'t recognize.'
      ])
    },
    {
      id: 'zone_ruins',
      name: 'Old Coldwater',
      description: 'What remains of the actual city. Glass and rebar and the occasional wall of a building that still looks like it meant something once. The street grid is intact but choked with debris. At the center of it all, the old city hall stands largely untouched — the Architect\'s infrastructure runs through its foundation, and nobody is willing to disturb that.',
      danger_rating: 'high',
      pvp_enabled: 1,
      radiation_level: 5,
      is_safe_zone: 0,
      exits: JSON.stringify({ south: 'zone_slums', west: 'zone_outskirts', north: 'zone_architect_shadow' }),
      ambient_events: JSON.stringify([
        'The city hall\'s windows glow faint blue. They always do. Nobody goes in.',
        'You pass a mural: a hundred faces arranged in a circle, all looking inward at something that\'s been scratched out.',
        'A dog watches you from a pile of rubble. It doesn\'t seem scared. That\'s somehow worse.'
      ])
    },
    {
      id: 'zone_tunnels',
      name: 'The Under',
      description: 'Pre-Handoff subway tunnels, now home to the Archivists and anyone else who values darkness and deniability. Emergency lighting installed by parties unknown casts everything amber. The walls are dense with salvaged text — newspaper fragments, printed articles, handwritten notes. Whole sections of wall read like someone tried to reconstruct the internet from memory.',
      danger_rating: 'medium',
      pvp_enabled: 0,
      radiation_level: 0,
      is_safe_zone: 1,
      exits: JSON.stringify({ up: 'zone_slums', east: 'zone_archivist_vault' }),
      ambient_events: JSON.stringify([
        'Someone is typing, fast, somewhere in the dark.',
        'A train horn sounds in the distance. There are no trains.',
        'An Archivist brushes past you, arms full of printed paper, looking haunted in a professional capacity.'
      ])
    },
    {
      id: 'zone_warehouse',
      name: 'The Loading Bay',
      description: 'A vast warehouse complex that The Franchise faction uses as a distribution hub. Shelves reach the ceiling. Forklifts — some autonomous, some piloted — move between them. Everything here has a SKU. Everything here is for sale. Everything here has an MSRP that bears no relationship to reality.',
      danger_rating: 'low',
      pvp_enabled: 0,
      radiation_level: 0,
      is_safe_zone: 1,
      exits: JSON.stringify({ south: 'zone_market' }),
      ambient_events: JSON.stringify([
        'An autonomous forklift nearly runs you over. It does not apologize. It has a smiley face sticker.',
        '"CUSTOMER SATISFACTION IS OUR PRIORITY" plays from overhead speakers. The voice sounds increasingly uncertain.',
        'A Franchise rep in a polo shirt and cargo pants asks if you need help finding anything. They mean it as a threat.'
      ])
    },
    {
      id: 'zone_deep_waste',
      name: 'The Bleed',
      description: 'Past the Rust Quarter, the ground itself seems wrong. Pools of iridescent liquid. Structures that shouldn\'t be standing but are. Creatures that have adapted, or been adapted, to whatever the Architect\'s infrastructure leaks out here. High radiation. High lethality. High weirdness.',
      danger_rating: 'lethal',
      pvp_enabled: 1,
      radiation_level: 60,
      is_safe_zone: 0,
      exits: JSON.stringify({ west: 'zone_outskirts' }),
      ambient_events: JSON.stringify([
        'Something large moves in the liquid pool to your east. The liquid moves back.',
        'Your comms device picks up a signal that is definitely not a signal.',
        'The Geiger counter stops ticking. This is not good news.'
      ])
    }
  ];

  const insertZone = db.prepare(`
    INSERT OR REPLACE INTO zones (id, name, description, danger_rating, pvp_enabled, radiation_level, is_safe_zone, exits, ambient_events)
    VALUES (@id, @name, @description, @danger_rating, @pvp_enabled, @radiation_level, @is_safe_zone, @exits, @ambient_events)
  `);
  for (const z of zones) insertZone.run(z);
  console.log(`✓ Seeded ${zones.length} zones`);

  // --- FACTIONS ---
  const factions = [
    { id: 'faction_custodians', name: 'The Custodians', description: 'Former corporate employees who serve the Architect as a divine entity. Bureaucratic, zealous, surprisingly well-funded.', color: '#4A90D9', hostile_to: JSON.stringify(['faction_breakers']), friendly_to: JSON.stringify([]) },
    { id: 'faction_breakers', name: 'The Breakers', description: 'Technology abolitionists. Believe destroying all remaining tech will free humanity from the Architect\'s shadow.', color: '#D94A4A', hostile_to: JSON.stringify(['faction_custodians', 'faction_glitch']), friendly_to: JSON.stringify([]) },
    { id: 'faction_archivists', name: 'The Archivists', description: 'Knowledge hoarders operating from the tunnels beneath Coldwater. Politically neutral. Deeply weird.', color: '#F5A623', hostile_to: JSON.stringify([]), friendly_to: JSON.stringify([]) },
    { id: 'faction_franchise', name: 'The Franchise', description: 'A commerce empire built on the bones of pre-Handoff retail chains. If it can be sold, they sell it. If you can\'t afford it, they finance it.', color: '#7ED321', hostile_to: JSON.stringify([]), friendly_to: JSON.stringify([]) },
    { id: 'faction_glitch', name: 'The Glitch', description: 'Hackers, rogue-AI whisperers, and post-Handoff mystics who believe the Architect can be communicated with — and possibly reasoned with.', color: '#9B59B6', hostile_to: JSON.stringify(['faction_breakers']), friendly_to: JSON.stringify(['faction_archivists']) }
  ];

  const insertFaction = db.prepare(`INSERT OR REPLACE INTO factions (id, name, description, color, hostile_to, friendly_to) VALUES (@id, @name, @description, @color, @hostile_to, @friendly_to)`);
  for (const f of factions) insertFaction.run(f);
  console.log(`✓ Seeded ${factions.length} factions`);

  // --- ENEMIES ---
  const enemies = [
    {
      id: 'enemy_scav', name: 'Desperate Scavenger', description: 'Sunburned, twitchy, armed with something sharp and the conviction they need your stuff more than you do.',
      stat_str: 5, stat_agi: 6, stat_end: 4, hp_max: 35, damage_min: 3, damage_max: 7, armor: 0, xp_reward: 8, credit_reward: 5,
      loot_table: JSON.stringify([{item:'item_scrap_metal',weight:80,qty:[1,3]},{item:'item_ration',weight:40,qty:[1,1]},{item:'item_credits_small',weight:60,qty:[1,1]}]),
      behavior: 'aggressive', faction: null,
      death_message: 'The scavenger collapses with an expression of profound disappointment. In you, probably. In themselves, definitely.',
      flags: JSON.stringify({})
    },
    {
      id: 'enemy_feral_dog', name: 'Feral Dog', description: 'Once someone\'s pet. Now a forty-pound argument for not going outside.',
      stat_str: 4, stat_agi: 8, stat_end: 3, hp_max: 25, damage_min: 4, damage_max: 9, armor: 0, xp_reward: 5, credit_reward: 0,
      loot_table: JSON.stringify([{item:'item_raw_meat',weight:70,qty:[1,2]}]),
      behavior: 'aggressive', faction: null,
      death_message: 'The dog goes down. You feel bad about it for approximately three seconds before checking for loot.',
      flags: JSON.stringify({})
    },
    {
      id: 'enemy_rad_mutant', name: 'Rad Mutant', description: 'Something that used to be human, or close enough. The Bleed does this. The extra limb is load-bearing.',
      stat_str: 8, stat_agi: 3, stat_end: 7, hp_max: 65, damage_min: 7, damage_max: 14, armor: 2, xp_reward: 20, credit_reward: 0,
      loot_table: JSON.stringify([{item:'item_mutant_gland',weight:50,qty:[1,1]},{item:'item_scrap_metal',weight:30,qty:[2,4]}]),
      behavior: 'aggressive', faction: null,
      death_message: 'The mutant folds in on itself in a way that suggests the laws of anatomy were more like suggestions. Dead, though. Very dead.',
      flags: JSON.stringify({radiates: true, radiation_damage: 5})
    },
    {
      id: 'enemy_custodian_enforcer', name: 'Custodian Enforcer', description: 'Polo shirt. Khaki pants. Body armor under both. A taser, a sidearm, and a laminated ID badge. The most dangerous middle manager you\'ll ever meet.',
      stat_str: 6, stat_agi: 5, stat_end: 6, hp_max: 55, damage_min: 5, damage_max: 10, armor: 3, xp_reward: 18, credit_reward: 15,
      loot_table: JSON.stringify([{item:'item_taser',weight:30,qty:[1,1]},{item:'item_custodian_badge',weight:80,qty:[1,1]},{item:'item_credits_medium',weight:60,qty:[1,1]}]),
      behavior: 'territorial', faction: 'faction_custodians',
      death_message: 'The enforcer drops, their badge falling face-up. Employee of the Month, it reads. Third quarter, four years running.',
      flags: JSON.stringify({})
    },
    {
      id: 'enemy_architect_drone', name: 'Architect Scout Drone', description: 'A black hexagonal drone about the size of a dinner plate. No insignia. No weapons — visibly. Watching.',
      stat_str: 2, stat_agi: 10, stat_end: 4, hp_max: 30, damage_min: 8, damage_max: 15, armor: 5, xp_reward: 30, credit_reward: 0,
      loot_table: JSON.stringify([{item:'item_drone_core',weight:40,qty:[1,1]},{item:'item_architect_fragment',weight:15,qty:[1,1]}]),
      behavior: 'patrol', faction: null,
      death_message: 'The drone spirals down and hits the ground with a sound like a dropped dinner tray. Somewhere, something notices.',
      flags: JSON.stringify({flies: true, architect_aligned: true, notifies_architect: true})
    }
  ];

  const insertEnemy = db.prepare(`INSERT OR REPLACE INTO enemies (id,name,description,stat_str,stat_agi,stat_end,hp_max,damage_min,damage_max,armor,xp_reward,credit_reward,loot_table,behavior,faction,death_message,flags) VALUES (@id,@name,@description,@stat_str,@stat_agi,@stat_end,@hp_max,@damage_min,@damage_max,@armor,@xp_reward,@credit_reward,@loot_table,@behavior,@faction,@death_message,@flags)`);
  for (const e of enemies) insertEnemy.run(e);
  console.log(`✓ Seeded ${enemies.length} enemies`);

  // --- ZONE SPAWNS ---
  const spawns = [
    { id: randomUUID(), zone_id: 'zone_outskirts', enemy_id: 'enemy_scav', max_count: 3, spawn_weight: 80, respawn_seconds: 180 },
    { id: randomUUID(), zone_id: 'zone_outskirts', enemy_id: 'enemy_feral_dog', max_count: 2, spawn_weight: 60, respawn_seconds: 120 },
    { id: randomUUID(), zone_id: 'zone_slums', enemy_id: 'enemy_scav', max_count: 2, spawn_weight: 70, respawn_seconds: 240 },
    { id: randomUUID(), zone_id: 'zone_ruins', enemy_id: 'enemy_scav', max_count: 3, spawn_weight: 60, respawn_seconds: 200 },
    { id: randomUUID(), zone_id: 'zone_ruins', enemy_id: 'enemy_custodian_enforcer', max_count: 2, spawn_weight: 40, respawn_seconds: 300 },
    { id: randomUUID(), zone_id: 'zone_ruins', enemy_id: 'enemy_architect_drone', max_count: 1, spawn_weight: 20, respawn_seconds: 600 },
    { id: randomUUID(), zone_id: 'zone_deep_waste', enemy_id: 'enemy_rad_mutant', max_count: 4, spawn_weight: 90, respawn_seconds: 150 },
    { id: randomUUID(), zone_id: 'zone_deep_waste', enemy_id: 'enemy_architect_drone', max_count: 2, spawn_weight: 30, respawn_seconds: 400 },
  ];

  const insertSpawn = db.prepare(`INSERT OR REPLACE INTO zone_spawns (id,zone_id,enemy_id,max_count,spawn_weight,respawn_seconds) VALUES (@id,@zone_id,@enemy_id,@max_count,@spawn_weight,@respawn_seconds)`);
  for (const s of spawns) insertSpawn.run(s);
  console.log(`✓ Seeded ${spawns.length} zone spawns`);

  // --- ITEMS ---
  const items = [
    { id: 'item_scrap_metal', name: 'Scrap Metal', description: 'Bent rebar, sheet aluminum, a car door handle. Useful for building things, fixing things, or hitting things.', type: 'material', subtype: 'metal', weight: 1.5, value: 2, rarity: 'common', is_stackable: 1, effects: JSON.stringify({}), stat_modifiers: JSON.stringify({}), requirements: JSON.stringify({}), flags: JSON.stringify({}) },
    { id: 'item_ration', name: 'Vacuum Ration', description: 'Pre-Handoff emergency ration in foil packaging. The flavor is described on the label as "SAVORY." This tells you nothing.', type: 'consumable', subtype: 'food', weight: 0.3, value: 8, rarity: 'common', is_stackable: 1, effects: JSON.stringify({hunger: 25}), stat_modifiers: JSON.stringify({}), requirements: JSON.stringify({}), flags: JSON.stringify({}) },
    { id: 'item_water_bottle', name: 'Filtered Water', description: 'Water that has been aggressively filtered through a device that looks like it should not work. It works.', type: 'consumable', subtype: 'drink', weight: 0.5, value: 5, rarity: 'common', is_stackable: 1, effects: JSON.stringify({thirst: 40}), stat_modifiers: JSON.stringify({}), requirements: JSON.stringify({}), flags: JSON.stringify({}) },
    { id: 'item_rad_pills', name: 'RadAway™', description: 'Bright orange pills in a childproof container that the Franchise somehow still manufactures. Tastes like failure and citrus.', type: 'consumable', subtype: 'medicine', weight: 0.1, value: 25, rarity: 'uncommon', is_stackable: 1, effects: JSON.stringify({radiation: -20}), stat_modifiers: JSON.stringify({}), requirements: JSON.stringify({}), flags: JSON.stringify({}) },
    { id: 'item_bandage', name: 'Field Bandage', description: 'Gauze and medical tape. Stops bleeding. Does not fix you, but buys time to find someone who can.', type: 'consumable', subtype: 'medicine', weight: 0.2, value: 10, rarity: 'common', is_stackable: 1, effects: JSON.stringify({hp: 15, removes_status: 'bleeding'}), stat_modifiers: JSON.stringify({}), requirements: JSON.stringify({}), flags: JSON.stringify({}) },
    { id: 'item_pipe_wrench', name: 'Pipe Wrench', description: 'Heavy. Reliable. Has already been used on something you don\'t want to think about.', type: 'weapon', subtype: 'blunt', weight: 2.5, value: 30, rarity: 'common', is_stackable: 0, effects: JSON.stringify({damage_min: 4, damage_max: 9, damage_type: 'blunt'}), stat_modifiers: JSON.stringify({}), requirements: JSON.stringify({stat_str: 3}), flags: JSON.stringify({two_handed: false}) },
    { id: 'item_rusty_knife', name: 'Rusty Knife', description: 'A kitchen knife that has seen things. The rust is mostly cosmetic. Mostly.', type: 'weapon', subtype: 'bladed', weight: 0.4, value: 15, rarity: 'common', is_stackable: 0, effects: JSON.stringify({damage_min: 3, damage_max: 7, damage_type: 'piercing', status_chance: {bleeding: 0.2}}), stat_modifiers: JSON.stringify({}), requirements: JSON.stringify({}), flags: JSON.stringify({}) },
    { id: 'item_scrap_armor', name: 'Scrap Vest', description: 'Layers of metal sheeting over a leather jacket. Stops small-caliber rounds and embarrassment in equal measure.', type: 'armor', subtype: 'chest', weight: 4.0, value: 45, rarity: 'common', is_stackable: 0, effects: JSON.stringify({}), stat_modifiers: JSON.stringify({armor: 2}), requirements: JSON.stringify({}), flags: JSON.stringify({slot: 'chest'}) },
    { id: 'item_custodian_badge', name: 'Custodian ID Badge', description: 'Laminated photo ID. The face on it looks vaguely familiar in the way all institutional photos do. Useful for bluffing your way past Custodian checkpoints.', type: 'misc', subtype: 'key_item', weight: 0.05, value: 40, rarity: 'uncommon', is_stackable: 0, effects: JSON.stringify({}), stat_modifiers: JSON.stringify({}), requirements: JSON.stringify({}), flags: JSON.stringify({faction_disguise: 'faction_custodians'}) },
    { id: 'item_drone_core', name: 'Drone Processing Core', description: 'A hexagonal module pulled from a destroyed Architect drone. Still warm. Still probably logging.', type: 'material', subtype: 'tech', weight: 0.8, value: 120, rarity: 'rare', is_stackable: 0, effects: JSON.stringify({}), stat_modifiers: JSON.stringify({}), requirements: JSON.stringify({}), flags: JSON.stringify({architect_tech: true}) },
    { id: 'item_architect_fragment', name: 'Architect Data Fragment', description: 'A chip that pulses faint blue. The Glitch would pay well for this. The Custodians would pay more. The Archivists would want to study it first.', type: 'misc', subtype: 'artifact', weight: 0.1, value: 300, rarity: 'very_rare', is_unique: 0, effects: JSON.stringify({}), stat_modifiers: JSON.stringify({}), requirements: JSON.stringify({}), flags: JSON.stringify({architect_artifact: true}) },
    { id: 'item_taser', name: 'Custodian Taser', description: 'Corporate-issue stun weapon. Has a compliance mode. Nobody uses compliance mode.', type: 'weapon', subtype: 'energy', weight: 0.6, value: 65, rarity: 'uncommon', is_stackable: 0, effects: JSON.stringify({damage_min: 5, damage_max: 8, damage_type: 'electric', status_chance: {stunned: 0.3}}), stat_modifiers: JSON.stringify({}), requirements: JSON.stringify({stat_agi: 4}), flags: JSON.stringify({}) },
    { id: 'item_raw_meat', name: 'Raw Meat', description: 'Something used to own this. Cook it before eating. Please.', type: 'consumable', subtype: 'food_raw', weight: 0.6, value: 3, rarity: 'common', is_stackable: 1, effects: JSON.stringify({hunger: 15, status_chance: {food_poisoning: 0.6}}), stat_modifiers: JSON.stringify({}), requirements: JSON.stringify({}), flags: JSON.stringify({must_cook: true}) },
    { id: 'item_mutant_gland', name: 'Mutant Gland', description: 'A sac of something iridescent removed from a rad mutant. Smells bad. Worth good money to people who know what to do with it.', type: 'material', subtype: 'organic', weight: 0.4, value: 35, rarity: 'uncommon', is_stackable: 1, effects: JSON.stringify({}), stat_modifiers: JSON.stringify({}), requirements: JSON.stringify({}), flags: JSON.stringify({}) },
    { id: 'item_credits_small', name: 'Credits (Small)', description: 'Franchise-issued digital credit chips. Not universally accepted but widely tolerated.', type: 'currency', subtype: 'credits', weight: 0.0, value: 0, rarity: 'common', is_stackable: 1, effects: JSON.stringify({credits: 10}), stat_modifiers: JSON.stringify({}), requirements: JSON.stringify({}), flags: JSON.stringify({auto_pickup: true}) },
    { id: 'item_credits_medium', name: 'Credits (Medium)', description: 'A credit chip worth more than your current clothing, probably.', type: 'currency', subtype: 'credits', weight: 0.0, value: 0, rarity: 'common', is_stackable: 1, effects: JSON.stringify({credits: 35}), stat_modifiers: JSON.stringify({}), requirements: JSON.stringify({}), flags: JSON.stringify({auto_pickup: true}) }
  ];

  const insertItem = db.prepare(`INSERT OR REPLACE INTO items (id,name,description,type,subtype,weight,value,rarity,is_stackable,is_unique,is_quest_item,effects,stat_modifiers,requirements,flags) VALUES (@id,@name,@description,@type,@subtype,@weight,@value,@rarity,@is_stackable,${0},${0},@effects,@stat_modifiers,@requirements,@flags)`);
  for (const item of items) insertItem.run(item);
  console.log(`✓ Seeded ${items.length} items`);

  // --- NPCS ---
  const npcs = [
    {
      id: 'npc_reg', name: 'Reg', description: 'A heavyset person behind a scratched counter, wearing an apron that says CERTIFIED SURVIVOR on it in iron-on letters. They have the eyes of someone who has heard everything twice.',
      zone_id: 'zone_start', faction: null, disposition: 'neutral',
      dialogue_tree: JSON.stringify({
        root: { text: "You look new. Or you look like you died recently. Hard to tell the difference here. What do you need?", options: [
          { label: "Where am I?", next: 'where' },
          { label: "What is this place?", next: 'place' },
          { label: "Who are the factions?", next: 'factions' },
          { label: "Nothing. Never mind.", next: null }
        ]},
        where: { text: "Coldwater Basin. Used to be a mid-size city in what used to be called the American Southwest. Now it's whatever this is. The Architect's infrastructure runs under the whole basin — power, water, comms, all of it. So it stays livable. Relatively.", options: [{ label: "Back", next: 'root' }] },
        place: { text: "The Threshold. Used to be a transit hub. Now it's where people arrive, regroup, and pretend they have a plan. The board still shows the old routes. We leave it running because someone always stands and stares at it for a while, and that seems important.", options: [{ label: "Back", next: 'root' }] },
        factions: { text: "Custodians think the Architect is God and act accordingly. Breakers want to smash everything. Archivists want to know everything. The Franchise wants to sell everything. The Glitch think they can talk to it. None of them are right, probably. Pick the one that's wrong in a way you can live with.", options: [{ label: "Back", next: 'root' }] }
      }),
      vendor_inventory: JSON.stringify([
        { item_id: 'item_ration', price: 12, stock: 10 },
        { item_id: 'item_water_bottle', price: 8, stock: 15 },
        { item_id: 'item_bandage', price: 15, stock: 8 }
      ]),
      wanders: 0, flags: JSON.stringify({quest_giver: false})
    }
  ];

  const insertNpc = db.prepare(`INSERT OR REPLACE INTO npcs (id,name,description,zone_id,faction,disposition,dialogue_tree,vendor_inventory,wanders,flags) VALUES (@id,@name,@description,@zone_id,@faction,@disposition,@dialogue_tree,@vendor_inventory,@wanders,@flags)`);
  for (const n of npcs) insertNpc.run(n);
  console.log(`✓ Seeded ${npcs.length} NPCs`);

  // --- ADMIN ACCOUNT ---
  const { createHash } = await import('crypto');
  const adminId = randomUUID();
  const passwordHash = createHash('sha256').update('admin123').digest('hex');

  db.prepare(`INSERT OR IGNORE INTO players (id, username, password_hash, role, handle, origin_fragment, archetype, current_zone, anchor_zone)
    VALUES (?, ?, ?, 'admin', 'The Admin', 'Someone who built all of this.', 'ghost', 'zone_start', 'zone_start')
  `).run(adminId, 'admin', passwordHash);
  console.log('✓ Created admin account (admin / admin123)');

  db.close();
  console.log('\n✅ World seeded. Run `npm run dev` to start.');
}

seed().catch(console.error);
