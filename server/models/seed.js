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

  // --- Grid/map backfill (idempotent) ---
  // Position every zone on a map by walking its EXITS, so this adapts to
  // whatever topology the world currently has rather than assuming a fixed
  // layout (on a pristine seed it reproduces the old hand-placed grid exactly;
  // on a hand-edited world it follows the real connections). The world is one
  // grid (map_world) laid out by BFS from its entry zone; each is_building zone
  // becomes the entry of its own interior map; any zones left disconnected are
  // dropped onto map_world as separate offset clusters so nothing is stranded.
  // Exits remain the source of truth for traversability — this only assigns
  // coordinates, guarded by `map_id IS NULL` so dev-panel placements are never
  // clobbered. Geometrically inconsistent or dangling exits are left as-is for
  // the overview editor to surface and the builder to resolve.
  await query(`INSERT INTO maps (id,name,parent_zone_id,entry_zone_id) VALUES ('map_world','Coldwater Basin',NULL,'zone_start') ON CONFLICT (id) DO NOTHING`);

  const DIR_OFFSET = { north:[0,-1,0], south:[0,1,0], east:[1,0,0], west:[-1,0,0], up:[0,0,1], down:[0,0,-1] };
  const { rows: bfZones } = await query(`SELECT id, exits, flags, map_id FROM zones`);
  const zoneById = new Map(bfZones.map(z => [z.id, z]));
  const isBuilding = id => !!zoneById.get(id)?.flags?.is_building;
  const isInterior = id => { const f = zoneById.get(id)?.flags || {}; return !!(f.is_interior || f.is_apartment); };

  // BFS from a start zone, accumulating exit deltas into grid coords. Stops at
  // zones already on another map (portals), missing zones (dangling), and —
  // per mode — at building entrances / non-interior zones, so world layout and
  // building interiors don't bleed into each other.
  //   mode 'world'    : skip building entrances and interior rooms.
  //   mode 'interior' : only pull interior rooms (and the building start) in.
  function bfsLayout(startId, mapId, originX, mode) {
    const coords = new Map([[startId, [originX, 0, 0]]]);
    const queue = [startId];
    while (queue.length) {
      const cur = queue.shift();
      const [cx, cy, cz] = coords.get(cur);
      for (const [dir, t] of Object.entries(zoneById.get(cur)?.exits || {})) {
        const off = DIR_OFFSET[dir];
        const tz = zoneById.get(t);
        if (!off || !tz || coords.has(t)) continue;
        if (tz.map_id && tz.map_id !== mapId) continue;            // already placed elsewhere (portal)
        if (mode === 'world' && (isBuilding(t) || isInterior(t))) continue;
        if (mode === 'interior' && !isInterior(t)) continue;       // don't leave the building
        coords.set(t, [cx + off[0], cy + off[1], cz + off[2]]);
        queue.push(t);
      }
    }
    return coords;
  }
  async function commitCoords(coords, mapId) {
    for (const [zid, [x, y, z]] of coords) {
      await query(`UPDATE zones SET map_id=$2, grid_x=$3, grid_y=$4, grid_z=$5 WHERE id=$1 AND map_id IS NULL`, [zid, mapId, x, y, z]);
      const zr = zoneById.get(zid); if (zr) zr.map_id = mapId;
    }
  }

  // 1) The main world, laid out from its entry zone — but ONLY when the world
  //    hasn't been laid out before. If the entry zone already has a position,
  //    this DB has been set up (or hand-edited) already; we leave existing
  //    placements alone and let any unplaced zones go to the overview's tray
  //    rather than risk dropping them on top of established cells.
  if (!zoneById.get('zone_start')?.map_id) {
    await commitCoords(bfsLayout('zone_start', 'map_world', 0, 'world'), 'map_world');
  }

  // 2) Each building gets its own interior map, laid out from the building.
  for (const b of bfZones.filter(z => z.flags?.is_building)) {
    if (zoneById.get(b.id)?.map_id) continue;
    const mapId = `map_interior_${b.id}`;
    // Prefer the world zone that has an exit INTO this building (the entrance);
    // fall back to a building exit leading back out to an already-placed zone.
    let parentZoneId = null;
    for (const z of bfZones) {
      if (zoneById.get(z.id)?.map_id !== 'map_world') continue;
      if (Object.values(z.exits || {}).includes(b.id)) { parentZoneId = z.id; break; }
    }
    if (!parentZoneId) {
      for (const t of Object.values(b.exits || {})) {
        if (zoneById.get(t)?.map_id && zoneById.get(t).map_id !== mapId) { parentZoneId = t; break; }
      }
    }
    await query(`INSERT INTO maps (id,name,parent_zone_id,entry_zone_id) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
      [mapId, b.flags?.building_name || b.id, parentZoneId, b.id]);
    await commitCoords(bfsLayout(b.id, mapId, 0, 'interior'), mapId);
  }

  // Anything left unplaced is a zone not reachable by exits from the entry
  // (disconnected/legacy content). We deliberately DON'T guess a position for
  // it — it surfaces in the overview editor's "Unplaced zones" tray for the
  // builder to drop onto the grid by hand. That manual placement is the whole
  // point of the tool, so the backfill stays honest about what it can't know.
  const { rows: unplaced } = await query(`SELECT id FROM zones WHERE map_id IS NULL`);
  if (unplaced.length) console.warn(`⚠ ${unplaced.length} unplaced zone(s) — place them via the dev panel's Maps overview: ${unplaced.map(z => z.id).join(', ')}`);
  console.log('✓ Grid/map backfill complete');

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

  // Drug items + drug definitions
  await query(`INSERT INTO items (id,name,description,type,subtype,weight,value,rarity,is_stackable,effects,flags) VALUES
    ('item_drug_buzz','Buzz','A cheap stimulant tab. Tastes like batteries.','drug',null,0.1,8,'common',1,'{}','{}'),
    ('item_drug_slow','Slow','A thick blue syrup. Time gets soft.','drug',null,0.2,15,'uncommon',1,'{}','{}'),
    ('item_drug_glasshollow','Glasshollow','Architect-adjacent. Nobody''s sure what it actually is. People take it anyway.','drug',null,0.1,40,'rare',1,'{}','{}')
    ON CONFLICT (id) DO NOTHING`);

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

  // Items (condensed)
  const items = [
    ['item_scrap_metal','Scrap Metal','Bent rebar and sheet aluminum.','material','metal',1.5,2,'common',1,'{}','{}','{}'],
    ['item_ration','Vacuum Ration','Pre-Handoff emergency ration. Flavor: SAVORY.','consumable','food',0.3,8,'common',1,'{"hunger":25}','{}','{}'],
    ['item_water_bottle','Filtered Water','Aggressively filtered water.','consumable','drink',0.5,5,'common',1,'{"thirst":40}','{}','{}'],
    ['item_rad_pills','RadAway™','Bright orange pills. Tastes like failure and citrus.','consumable','medicine',0.1,25,'uncommon',1,'{"radiation":-20}','{}','{}'],
    ['item_bandage','Field Bandage','Gauze and tape. Stops bleeding, eventually — not instantly, whatever the label implies.','consumable','medicine',0.2,10,'common',1,'{"hp_over_time":{"amount":18,"duration_seconds":180}}','{}','{}'],
    ['item_medkit','Trauma Kit','Real medical supplies. Increasingly rare, increasingly suspicious about why someone is selling them.','consumable','medicine',1.2,55,'uncommon',1,'{"hp_over_time":{"amount":50,"duration_seconds":300}}','{}','{}'],
    ['item_pipe_wrench','Pipe Wrench','Heavy. Reliable. Pre-used.','weapon','blunt',2.5,30,'common',0,'{"damage_min":4,"damage_max":9}','{"stat_str":3}','{"slot":"weapon_hand"}'],
    ['item_rusty_knife','Rusty Knife','A kitchen knife that has seen things.','weapon','bladed',0.4,15,'common',0,'{"damage_min":3,"damage_max":7}','{}','{"slot":"weapon_hand"}'],
    ['item_scrap_armor','Scrap Vest','Metal sheeting over a leather jacket.','armor','chest',4.0,45,'common',0,'{"armor":3}','{}','{"slot":"torso"}'],
    ['item_custodian_badge','Custodian ID Badge','Useful for bluffing Custodian checkpoints.','misc','key_item',0.05,40,'uncommon',0,'{}','{}','{}'],
    ['item_drone_core','Drone Processing Core','Still warm. Still probably logging.','material','tech',0.8,120,'rare',0,'{}','{}','{}'],
    ['item_architect_fragment','Architect Data Fragment','Pulses faint blue. Three factions want this.','misc','artifact',0.1,300,'very_rare',0,'{}','{}','{}'],
    ['item_taser','Custodian Taser','Corporate-issue stun weapon.','weapon','energy',0.6,65,'uncommon',0,'{"damage_min":5,"damage_max":8,"status_chance":{"stunned":0.3}}','{"stat_agi":4}','{"slot":"weapon_hand"}'],
    ['item_raw_meat','Raw Meat','Something used to own this. Cook before eating.','consumable','food_raw',0.6,3,'common',1,'{"hunger":15,"status_chance":{"food_poisoning":0.6}}','{}','{}'],
    ['item_mutant_gland','Mutant Gland','Iridescent and foul. Worth money to the right people.','material','organic',0.4,35,'uncommon',1,'{}','{}','{}'],
    ['item_credits_small','Credits (Small)','Franchise-issued digital credit chips.','currency','credits',0,0,'common',1,'{"credits":10}','{}','{}'],
    ['item_credits_medium','Credits (Medium)','A credit chip worth more than your clothing.','currency','credits',0,0,'common',1,'{"credits":35}','{}','{}'],
    ['item_scrap_helmet','Scrap Helmet','A motorcycle helmet with extra rivets. Visor status: optimistic.','armor','head',1.0,20,'common',0,'{"armor":2}','{}','{"slot":"head"}'],
    ['item_cargo_pants','Reinforced Cargo Pants','Pockets for days. Knees patched twice over.','armor','legs',1.5,18,'common',0,'{"armor":2}','{}','{"slot":"legs"}'],
    ['item_steel_boots','Steel-Toed Boots','Standard issue, several owners ago.','armor','feet',1.2,16,'common',0,'{"armor":1}','{}','{"slot":"feet"}'],
    ['item_rad_band','Rad-Counter Wristband','Clicks faster the worse your day is going.','misc','accessory',0.1,25,'uncommon',0,'{}','{}','{"slot":"accessory"}'],
    ['item_work_gloves','Work Gloves','Stained in ways you choose not to think about.','armor','hands',0.3,8,'common',0,'{}','{}','{"slot":"hands"}'],
    ['item_drink_basin_swill','Basin Swill','House drink. Nobody has ever asked what\'s in it twice.','consumable','drink',0.4,4,'common',1,'{"thirst":15,"sanity":3}','{}','{}'],
    ['item_drink_rust_whiskey','Rust Whiskey','Tastes like it was filtered through the pipe it\'s named after. Probably was.','consumable','drink',0.4,9,'common',1,'{"thirst":10,"sanity":8,"hp":-2}','{}','{}'],
    ['item_drink_glow_cocktail','Glow Cocktail','Faintly luminescent. The bartender swears the radiation is "mostly cosmetic."','consumable','drink',0.4,14,'uncommon',1,'{"thirst":12,"sanity":12,"radiation":4}','{}','{}'],
    ['item_drink_embassy_reserve','Embassy Reserve','Aged in what used to be a wine cellar and is now mostly intact. The only drink in the basin served with a paper umbrella, against everyone\'s better judgment.','consumable','drink',0.4,22,'rare',1,'{"thirst":18,"sanity":18,"hp":3}','{}','{}'],
    ['item_embassy_canapes','Embassy Canapés','Bite-sized, garnished, served on an actual plate. Nobody asks what\'s in them; the presentation is doing all the work.','consumable','food',0.2,9,'uncommon',1,'{"hunger":14,"sanity":5}','{}','{}'],
    ['item_bar_jerky','Mystery Jerky','Labeled "MEAT-ADJACENT." Surprisingly not the worst thing on the menu.','consumable','food',0.2,6,'common',1,'{"hunger":18}','{}','{}'],
  ];
  for (const [id,name,desc,type,subtype,weight,value,rarity,stackable,effects,reqs,flags] of items) {
    await query(`INSERT INTO items (id,name,description,type,subtype,weight,value,rarity,is_stackable,effects,requirements,flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
      [id,name,desc,type,subtype,weight,value,rarity,stackable,effects,reqs,flags]);
  }
  console.log(`✓ Seeded ${items.length} items`);

  // Furniture — non-takeable scenery, examine-only. Stocking the Embassy
  // Hotel & Bar lobby as the first real test of the system: the bar
  // counter, stools, and corkboard the zone's own description already
  // mentions are now individually examine-able. Idempotent (DO UPDATE)
  // since this is exactly the kind of content an admin re-seeds while
  // testing the dev panel's add/edit/delete flow.
  const furniture = [
    ['furniture_embassy_bar_counter','zone_residential_lobby','The Embassy Lounge Bar','A scarred wooden counter beneath the brass THE EMBASSY LOUNGE sign. Lowry keeps it spotless out of sheer habit.'],
    ['furniture_embassy_stools','zone_residential_lobby','Cracked Vinyl Stools','A half-dozen stools lined up at the counter, vinyl split and patched with duct tape. Free to sit, if you don\'t mind the wobble.'],
    ['furniture_embassy_corkboard','zone_residential_lobby','Unit Listings Corkboard','Bolted over what used to be the concierge desk. Handwritten unit listings cover every inch, half of them crossed out and re-listed at a worse price.'],
  ];
  for (const [id,zoneId,name,desc] of furniture) {
    await query(`INSERT INTO furniture (id,zone_id,name,description,flags) VALUES ($1,$2,$3,$4,'{}')
      ON CONFLICT (id) DO UPDATE SET zone_id = EXCLUDED.zone_id, name = EXCLUDED.name, description = EXCLUDED.description`,
      [id,zoneId,name,desc]);
  }
  console.log(`✓ Seeded ${furniture.length} furniture`);

  // Lights — overhead lights and lamps are player-switchable (the "switch"
  // command, room by room); street lights are NOT — they're city-grid
  // infrastructure that follows the day/night cycle automatically instead
  // (see environment.js's tick30m). Seeded "on" here, matching the
  // generators below starting in the running state; environment.js
  // re-syncs street lights to the actual current time on every boot.
  const lights = [
    ['furniture_embassy_overhead','zone_residential_lobby','Lobby Overhead Lights','A row of caged fluorescent fixtures along the ceiling, humming faintly. A switch by the door controls them.','overhead'],
    ['furniture_embassy_bar_lamp','zone_residential_lobby','Bar Lamp','A small brass lamp at the end of the counter — the one bit of lighting in the room that isn\'t fluorescent.','lamp'],
    ['furniture_apt1_overhead','zone_apt_1','Overhead Light','A bare bulb on a pull-chain. Functional, nothing more.','overhead'],
    ['furniture_apt2_overhead','zone_apt_2','Overhead Light','A bare bulb on a pull-chain. Functional, nothing more.','overhead'],
    ['furniture_apt3_overhead','zone_apt_3','Overhead Light','A bare bulb on a pull-chain. Functional, nothing more.','overhead'],
    ['furniture_apt4_overhead','zone_apt_4','Overhead Light','A bare bulb on a pull-chain. Functional, nothing more.','overhead'],
  ];
  for (const [id,zoneId,name,desc,lightType] of lights) {
    await query(`INSERT INTO furniture (id,zone_id,name,description,flags,is_light,light_on,light_type) VALUES ($1,$2,$3,$4,'{}',1,1,$5)
      ON CONFLICT (id) DO UPDATE SET zone_id = EXCLUDED.zone_id, name = EXCLUDED.name, description = EXCLUDED.description, is_light = 1, light_type = EXCLUDED.light_type`,
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
      `INSERT INTO furniture (id,zone_id,name,description,flags,is_light,light_on,light_type) VALUES ($1,$2,$3,$4,'{}',1,1,'streetlight')
       ON CONFLICT (id) DO UPDATE SET zone_id = EXCLUDED.zone_id, is_light = 1, light_type = 'streetlight'`,
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
  console.log(`✓ Power grid: city plant covering ${outdoorZoneIds.length} zones, Embassy generator covering ${embassyZoneIds.length} zones`);

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
  console.log('✓ Seeded 3 NPCs');

  // Admin account
  await query(`INSERT INTO players (id,username,password_hash,role,handle,origin_fragment,archetype) VALUES ($1,$2,$3,'admin',$4,$5,$6) ON CONFLICT DO NOTHING`,
    [randomUUID(),'admin',hashPassword('admin123'),'The Architect','The presence that built all of this, and watches it now.','ghost']);
  console.log('✓ Created admin (admin / admin123)');
  console.log('\n✅ World seeded.');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
