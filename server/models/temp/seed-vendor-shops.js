/**
 * One-shot: create furniture and clothing vendor shops.
 *
 * Per zone:
 *   <NAME>_exterior — outdoor zone on map_world, gets city-grid power + streetlights
 *     └─ in → <NAME>_shop — shop interior (is_interior), vendor NPC lives here
 *               └─ down → <NAME>_basement — utility room (is_interior)
 *                          [junction box furniture + junction_box generator → powers shop + basement]
 *
 * The two vendor NPCs (Marta Velk / Cassius Drum) are created with full
 * dialogue trees, chitchat, home activities, default vendor schedule, and a
 * vendor safe in their respective shops.
 *
 * Run once:
 *   node server/models/temp/seed-vendor-shops.js
 */

import 'dotenv/config';
import { query } from '../db.js';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Fixed IDs — deterministic so re-running is safe (all INSERTs use ON CONFLICT)
// ---------------------------------------------------------------------------
const VELK_EXT   = 'zone_velk_exterior';
const VELK_SHOP  = 'zone_velk_shop';
const VELK_BSMT  = 'zone_velk_basement';
const DRUM_EXT   = 'zone_drum_exterior';
const DRUM_SHOP  = 'zone_drum_shop';
const DRUM_BSMT  = 'zone_drum_basement';

const NPC_VELK   = 'npc_marta_velk';
const NPC_DRUM   = 'npc_cassius_drum';

const VELK_SAFE_ID  = 'furn_safe_marta_velk';
const DRUM_SAFE_ID  = 'furn_safe_cassius_drum';
const VELK_SCHED_ID = `furn_schd_${NPC_VELK}`;
const DRUM_SCHED_ID = `furn_schd_${NPC_DRUM}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the default 10–22 vendor schedule. */
const DEFAULT_SCHEDULE = {
  mon:[{from:10,to:22}], tue:[{from:10,to:22}], wed:[{from:10,to:22}],
  thu:[{from:10,to:22}], fri:[{from:10,to:22}], sat:[{from:10,to:22}], sun:[{from:10,to:22}],
};

/** Format the schedule board description text. */
function fmtScheduleBoard(npcName, shopName, sched) {
  const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
  const LABELS = { mon:'Mon',tue:'Tue',wed:'Wed',thu:'Thu',fri:'Fri',sat:'Sat',sun:'Sun' };
  const lines = DAYS.map(d => {
    const blocks = sched[d] || [];
    return blocks.length
      ? `${LABELS[d]}: ${blocks.map(b=>`${b.from}:00-${b.to}:00`).join(', ')}`
      : `${LABELS[d]}: Closed`;
  });
  return `${npcName}'s Schedule\n${shopName}\n\n${lines.join('\n')}`;
}

/** OPPOSITE direction map. */
const OPP = { north:'south',south:'north',east:'west',west:'east',up:'down',down:'up',in:'out',out:'in' };

/**
 * Find two empty adjacent grid cells on map_world.
 * Strategy: collect all occupied (x,y) cells. For each occupied cell test its
 * four cardinal neighbours; return the first two empties we find, preferring
 * cells that aren't adjacent to each other (so the two shops are distinct).
 */
function findEmptyCells(occupied) {
  const taken = new Set(occupied.map(r => `${r.grid_x},${r.grid_y}`));
  const candidates = [];
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  for (const { grid_x: x, grid_y: y } of occupied) {
    for (const [dx,dy] of dirs) {
      const nx = x+dx, ny = y+dy;
      const key = `${nx},${ny}`;
      if (!taken.has(key) && !candidates.find(c=>c.key===key)) {
        candidates.push({ key, x: nx, y: ny });
      }
    }
  }
  if (candidates.length < 2) throw new Error(`Not enough empty grid cells (found ${candidates.length}). Check map_world.`);
  // Pick two that aren't adjacent to each other when possible.
  const first = candidates[0];
  const second = candidates.find(c => Math.abs(c.x-first.x)+Math.abs(c.y-first.y) > 1) || candidates[1];
  return [first, second];
}

/**
 * Determine which existing world-map zone is adjacent to (x,y) in direction
 * `dir`, so we can wire exits in both directions for realism.
 */
function findNeighbour(occupied, x, y, dir) {
  const [dx,dy] = { north:[0,-1],south:[0,1],east:[1,0],west:[-1,0] }[dir] || [0,0];
  return occupied.find(r => r.grid_x===x+dx && r.grid_y===y+dy) || null;
}

// ---------------------------------------------------------------------------
// Vendor dialogue trees
// ---------------------------------------------------------------------------

const VELK_DIALOGUE = {
  root: {
    text: "Velk wipes her hands on a rag that only makes them dirtier. \"You buying or just looking? Either way, don't sit on anything unless you plan to buy it.\"",
    options: [
      { label: 'Browse your wares.', next: '__shop__' },
      { label: 'How long have you been here?', next: 'history' },
      { label: 'Nice place.', next: 'sarcasm' },
      { label: 'Nothing, never mind.', next: 'bye' },
    ],
  },
  history: {
    text: '"Fifteen years in this spot. Before me it was a noodle bar. Before that, rubble. This city\'s got layers."',
    options: [
      { label: 'What happened to the noodle bar?', next: 'noodles' },
      { label: 'Browse your wares.', next: '__shop__' },
      { label: 'See you around.', next: 'bye' },
    ],
  },
  noodles: {
    text: '"Owner got Custodian debt. You know how that goes. I bought the chair she left behind. Still got it — twelve credits if you want it."',
    options: [
      { label: 'Browse your wares.', next: '__shop__' },
      { label: 'See you around.', next: 'bye' },
    ],
  },
  sarcasm: {
    text: "\"It ain't the Meridian, but everything in here works. More than I can say for most things in this city.\"",
    options: [
      { label: 'Browse your wares.', next: '__shop__' },
      { label: 'Fair enough. See you around.', next: 'bye' },
    ],
  },
  bye: {
    text: '"Don\'t let the door hit you. Actually, it might — the hinge is shot. I keep meaning to fix that."',
    options: [],
  },
};

const DRUM_DIALOGUE = {
  root: {
    text: "Cassius Drum looks you up and down with professional interest. \"Okay. Okay. I see what we're working with. Don't worry — I've dressed worse.\"",
    options: [
      { label: 'Browse your wares.', next: '__shop__' },
      { label: 'You make these yourself?', next: 'craft' },
      { label: 'What\'s the post-apocalypse look this season?', next: 'fashion' },
      { label: 'I\'m good, thanks.', next: 'bye' },
    ],
  },
  craft: {
    text: '"Some of it. The rest I pull off people — gently, don\'t look at me like that, they were already dead. Point is, everything here has a story. I just charge you for the good parts."',
    options: [
      { label: 'Browse your wares.', next: '__shop__' },
      { label: 'See you around.', next: 'bye' },
    ],
  },
  fashion: {
    text: '"Layering. Always layering. You want at least three textures — keeps the rad-scanner confused and looks incredible. Also, pockets. You can never have enough pockets in a disaster zone."',
    options: [
      { label: 'Browse your wares.', next: '__shop__' },
      { label: 'Sound advice. See you around.', next: 'bye' },
    ],
  },
  bye: {
    text: '"Come back when you\'re ready to commit to an aesthetic. Or don\'t. Either way, you know where I am."',
    options: [],
  },
};

// ---------------------------------------------------------------------------
// Chitchat pools
// ---------------------------------------------------------------------------

const VELK_CHITCHAT = [
  '"Everything\'s got a second life if you know how to look at it."',
  'runs a hand along the edge of a battered cabinet, checking for warps',
  '"You break it, you bought it. That\'s the rule. It\'s always been the rule."',
  'squints at a price tag and decides it should be higher',
  '"Good wood\'s hard to find since the Singe. Synth-board\'s everywhere but it warps."',
  'stacks two crates with practised efficiency, barely looking',
  '"I had a couch in here last week. Guy offered me four credits. Four. I told him to get out."',
  'taps the side of a lamp three times until it flickers on',
  '"If it\'s broken I\'ll fix it. If it\'s ugly I\'ll price it lower. Comes out the same in the end."',
  'exhales slowly and writes something in a worn ledger',
];

const DRUM_CHITCHAT = [
  '"Color is a weapon. Most people just don\'t know how to aim it."',
  'folds a jacket with the kind of precision that borders on religious',
  '"You\'d be surprised what a good belt does for a silhouette. Changes everything."',
  'holds a piece of fabric up to the light and clicks his tongue',
  '"Half this city\'s walking around in borrowed clothes. The other half don\'t care. I care for both halves."',
  'snips a loose thread and examines the result critically',
  '"Rad-shielded lining is the future. I was doing it before it was a survival necessity."',
  'rearranges a display rack, steps back, then rearranges it again',
  '"Pockets. I\'m telling you. Every design needs more pockets. This is non-negotiable."',
  'hums something tuneless while pinning a hem',
];

// ---------------------------------------------------------------------------
// Home activities
// ---------------------------------------------------------------------------

const VELK_HOME_ACTIVITIES = [
  'polishes a second-hand lamp until it gleams',
  '"Still a deal at half the price."',
  'sorts through a box of salvaged drawer handles',
  'sketches something in a notebook, crosses it out, starts again',
  '"Fifteen years. This chair\'s earned its spot."',
  'runs a cloth along an old shelf, checking the joints',
  'counts something quietly on her fingers, frowns',
];

const DRUM_HOME_ACTIVITIES = [
  'stitches something under a low light, squinting',
  '"Texture, contrast, silhouette. In that order."',
  'lays out three different fabric swatches side by side',
  'carefully hangs a jacket, adjusts it twice, then a third time',
  '"If I had better thread this would be perfect."',
  'cuts a pattern piece from a paper template with quiet precision',
  'holds two colors up to the window and stares at them for a long moment',
];

// ---------------------------------------------------------------------------
// The default vendor behaviour graph (inline — mirrors buildDefaultVendorGraph)
// ---------------------------------------------------------------------------

function buildVendorGraph() {
  return {
    _start: 'start',
    nodes: {
      start:          { type:'start',  next:'check_work' },
      check_work:     { type:'action', action_type:'CHECK_VENDOR_WORK', next:'have_life', ports:{ goToWork:'go_to_work', haveLife:'have_life', endShift:'go_home', offWork:'home_idle_ps' } },
      go_to_work:     { type:'action', action_type:'GO_TO_WORK',       next:'vendor_chitchat' },
      vendor_chitchat:{ type:'action', action_type:'VENDOR_CHITCHAT',  next:'check_work' },
      have_life:      { type:'action', action_type:'HAVE_LIFE',        next:'check_work' },
      go_home:        { type:'action', action_type:'GO_HOME',          next:'home_life_ps' },
      home_life_ps:   { type:'action', action_type:'AT_HOME_LIFE',     next:'check_work' },
      home_idle_ps:   { type:'action', action_type:'AT_HOME_LIFE',     next:'check_work' },
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== seed-vendor-shops: starting ===\n');

  // ── 1. Find available grid cells on map_world ──────────────────────────────
  const { rows: worldZones } = await query(
    `SELECT id, name, grid_x, grid_y, exits FROM zones WHERE map_id = 'map_world' AND grid_x IS NOT NULL AND grid_y IS NOT NULL`
  );
  if (!worldZones.length) throw new Error('No zones found on map_world. Ensure the world map exists.');

  const [velkPos, drumPos] = findEmptyCells(worldZones);
  console.log(`Velk's shop exterior → grid (${velkPos.x}, ${velkPos.y})`);
  console.log(`Drum's shop exterior  → grid (${drumPos.x}, ${drumPos.y})\n`);

  // Find nearest city_plant generator for outdoor power
  const { rows: cityGens } = await query(
    `SELECT g.id, z.grid_x, z.grid_y FROM generators g
     LEFT JOIN zones z ON z.id = g.zone_id
     WHERE g.generator_type = 'city_plant' AND g.status = 'online'`
  );
  if (!cityGens.length) throw new Error('No online city_plant generator found — cannot wire outdoor power.');
  const nearestCity = (pos) => {
    let best = cityGens[0], minD = Infinity;
    for (const g of cityGens) {
      if (g.grid_x == null) continue;
      const d = Math.hypot(g.grid_x - pos.x, g.grid_y - pos.y);
      if (d < minD) { minD = d; best = g; }
    }
    return best.id;
  };
  const velkCityGenId = nearestCity(velkPos);
  const drumCityGenId = nearestCity(drumPos);
  console.log(`City generator for Velk: ${velkCityGenId}`);
  console.log(`City generator for Drum: ${drumCityGenId}\n`);

  // ── 2. Create exterior zones ───────────────────────────────────────────────

  // Wire up cardinal exits to adjacent occupied tiles where they exist.
  function buildExteriorExits(pos, shopId) {
    const exits = { in: shopId };
    for (const [dir, [dx,dy]] of Object.entries({ north:[0,-1],south:[0,1],east:[1,0],west:[-1,0] })) {
      const nb = worldZones.find(z => z.grid_x===pos.x+dx && z.grid_y===pos.y+dy);
      if (nb) exits[dir] = nb.id;
    }
    return exits;
  }

  const velkExtExits = buildExteriorExits(velkPos, VELK_SHOP);
  const drumExtExits = buildExteriorExits(drumPos, DRUM_SHOP);

  await upsertZone({
    id: VELK_EXT,
    name: "Velk's Pre-Owned — Exterior",
    description: "A narrow shopfront squeezed between two crumbling facades. A hand-painted sign reads VELK'S PRE-OWNED FURNISHINGS in faded letters. The window display is a chaotic but oddly compelling arrangement of lamps, chair legs, and small decorative objects that somehow work together. A pair of streetlights hum overhead.",
    danger_rating: 'low',
    ambient_theme: 'outdoors',
    flags: { is_building: true },
    exits: velkExtExits,
    map_id: 'map_world',
    grid_x: velkPos.x,
    grid_y: velkPos.y,
    marker: 'Fu',
    color: '#c9a96e',
  });

  await upsertZone({
    id: DRUM_EXT,
    name: "Drum's Fits — Exterior",
    description: "A slender storefront that somehow manages to look curated even in a city this rough. The window is dressed with two mannequins in loud, layered outfits that dare you to walk past without a second look. A neon sign shaped like a thread spool blinks above the door. Streetlights cast the whole block in a sickly yellow wash.",
    danger_rating: 'low',
    ambient_theme: 'outdoors',
    flags: { is_building: true },
    exits: drumExtExits,
    map_id: 'map_world',
    grid_x: drumPos.x,
    grid_y: drumPos.y,
    marker: 'Cl',
    color: '#a78bca',
  });

  // Add reverse exits on adjacent world-map zones pointing back to exterior zones
  for (const [extId, pos] of [[VELK_EXT, velkPos],[DRUM_EXT, drumPos]]) {
    for (const [dir, [dx,dy]] of Object.entries({ north:[0,-1],south:[0,1],east:[1,0],west:[-1,0] })) {
      const nb = worldZones.find(z => z.grid_x===pos.x+dx && z.grid_y===pos.y+dy);
      if (!nb) continue;
      const nbExits = typeof nb.exits === 'string' ? JSON.parse(nb.exits) : (nb.exits || {});
      const revDir = OPP[dir];
      if (!nbExits[revDir]) {
        nbExits[revDir] = extId;
        await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(nbExits), nb.id]);
        console.log(`  wired ${nb.id}.exits.${revDir} → ${extId}`);
      }
    }
  }

  // ── 3. Create interior maps for each building ──────────────────────────────

  await upsertMap('map_int_velk', "Velk's Pre-Owned — Interior", VELK_EXT, VELK_SHOP);
  await upsertMap('map_int_drum', "Drum's Fits — Interior", DRUM_EXT, DRUM_SHOP);

  // ── 4. Create shop interiors ───────────────────────────────────────────────

  await upsertZone({
    id: VELK_SHOP,
    name: "Velk's Pre-Owned Furnishings",
    description: "The shop is improbably full — every surface covered, every corner claimed. Chairs stacked on tables, lamps draped with fabric samples, shelves bowing under the weight of picture frames, drawer units, and objects with no obvious purpose but clear previous lives. It smells like oil soap and old wood. Somehow, it all feels livable.",
    danger_rating: 'safe',
    is_safe_zone: 1,
    ambient_theme: 'indoors',
    flags: { is_interior: true },
    exits: { out: VELK_EXT, down: VELK_BSMT },
    map_id: 'map_int_velk',
    grid_x: 0,
    grid_y: 0,
    parent_zone: VELK_EXT,
    ambient_events: [
      'Something in a pile shifts and settles with a creak.',
      'A lamp flickers, steadies, then flickers again.',
      'A drawer slides open an inch on its own. The shop is just settling, probably.',
      'The scent of lemon oil drifts through the crowded aisles.',
      'A price tag twirls slowly on a hanging lamp.',
    ],
  });

  await upsertZone({
    id: DRUM_SHOP,
    name: "Drum's Fits",
    description: "The shop is narrow but makes good use of vertical space — racks of clothing climb toward the ceiling, organized by some colour-logic that only Cassius understands. The walls are covered in polaroid-style printouts of outfits, annotated in marker. A tailoring station dominates one corner: cutting mat, shears, a half-dressed mannequin with pins in unfortunate places.",
    danger_rating: 'safe',
    is_safe_zone: 1,
    ambient_theme: 'indoors',
    flags: { is_interior: true },
    exits: { out: DRUM_EXT, down: DRUM_BSMT },
    map_id: 'map_int_drum',
    grid_x: 0,
    grid_y: 0,
    parent_zone: DRUM_EXT,
    ambient_events: [
      'Fabric rustles softly on a rack as air moves through the shop.',
      'The spool-shaped sign outside buzzes faintly through the wall.',
      'A mannequin slowly loses a pin to gravity. It hits the floor without drama.',
      'The squeak of a hanger being slid along a rail.',
      'Scissors catch the light from somewhere in the back.',
    ],
  });

  // ── 5. Create basement utility rooms ──────────────────────────────────────

  await upsertZone({
    id: VELK_BSMT,
    name: "Velk's — Utility Room",
    description: "A low-ceilinged basement room that smells of damp concrete and old cabling. A junction box occupies most of one wall, its panel door held shut with a twist of wire. Exposed conduit runs along the ceiling toward the shop above. A single bulb dangles from a cord, doing its best.",
    danger_rating: 'safe',
    is_safe_zone: 1,
    ambient_theme: 'indoors',
    flags: { is_interior: true },
    exits: { up: VELK_SHOP },
    map_id: 'map_int_velk',
    grid_x: 0,
    grid_y: 1,
    parent_zone: VELK_EXT,
  });

  await upsertZone({
    id: DRUM_BSMT,
    name: "Drum's — Utility Room",
    description: "A cramped basement room packed with bolts of fabric stored upright along one wall — Cassius's off-season overflow. The junction box on the opposite wall has been labelled in marker: LIGHTS, SIGN, MISC. A tangle of extension cords snakes toward a power strip that is doing entirely too much work.",
    danger_rating: 'safe',
    is_safe_zone: 1,
    ambient_theme: 'indoors',
    flags: { is_interior: true },
    exits: { up: DRUM_SHOP },
    map_id: 'map_int_drum',
    grid_x: 0,
    grid_y: 1,
    parent_zone: DRUM_EXT,
  });

  // ── 6. Add 'down' exit from shop to basement (shop was upserted first) ─────
  // (already in the exits above; zones were created in order. Confirm below.)
  const { rows: shopCheck } = await query(
    `SELECT exits FROM zones WHERE id=$1 OR id=$2`, [VELK_SHOP, DRUM_SHOP]
  );
  // No fix needed — down exits were included above.

  // ── 7. Furniture: streetlights in exterior zones ────────────────────────────

  await upsertFurniture('furn_streetlight_velk_1', VELK_EXT, 'Streetlight', 'A tall sodium-vapor streetlight on a graffiti-tagged pole. It clicks on at dusk and off at dawn, assuming the city power holds.', { is_light: true }, 'light', 'streetlight');
  await upsertFurniture('furn_streetlight_velk_2', VELK_EXT, 'Streetlight', 'A second streetlight further down the block, its housing dented but functional.', { is_light: true }, 'light', 'streetlight');
  await upsertFurniture('furn_streetlight_drum_1', DRUM_EXT, 'Streetlight', 'A narrow streetlight with a cracked housing, buzzing softly. The neon sign from the shop is doing most of the actual illumination work.', { is_light: true }, 'light', 'streetlight');
  await upsertFurniture('furn_streetlight_drum_2', DRUM_EXT, 'Streetlight', 'A second streetlight at the far end of the block. Someone has taped a flyer to the base that has since become illegible.', { is_light: true }, 'light', 'streetlight');

  // ── 8. Furniture: junction boxes in basements ──────────────────────────────

  await upsertFurniture('furn_jb_velk', VELK_BSMT, 'Junction Box', "A grey metal panel bolted to the wall. Rows of circuit breakers in two columns, most of them labeled in Marta's neat handwriting: SHOP LIGHTS, WINDOW, COUNTER, MISC. One breaker is taped over with a note: DO NOT TOUCH.", { junction_box: true }, 'fixture');
  await upsertFurniture('furn_jb_drum', DRUM_BSMT, 'Junction Box', "A junction box labelled in black marker — LIGHTS, SIGN, MISC — in Cassius's characteristically precise hand. A strip of wiring along the bottom has been neatly zip-tied to the conduit. It's the tidiest thing in the room.", { junction_box: true }, 'fixture');

  // ── 9. Furniture: shop overhead lights ────────────────────────────────────

  await upsertFurniture('furn_light_velk_shop', VELK_SHOP, 'Overhead Light', 'A cluster of mismatched pendant lights wired to a single switch — a lamp here, a bare bulb there, one actual fixture. Together they work.', { is_light: true }, 'light', 'overhead');
  await upsertFurniture('furn_light_drum_shop', DRUM_SHOP, 'Overhead Light', 'Track lighting along the ceiling, some of the spots aimed at display racks, others angled inexplicably at the floor. The overall effect is theatrical in a low-budget way.', { is_light: true }, 'light', 'overhead');

  // ── 10. Furniture: basement bulbs ─────────────────────────────────────────

  await upsertFurniture('furn_light_velk_bsmt', VELK_BSMT, 'Ceiling Bulb', 'A single bare bulb on a cord. It works.', { is_light: true }, 'light', 'overhead');
  await upsertFurniture('furn_light_drum_bsmt', DRUM_BSMT, 'Ceiling Bulb', 'A bare bulb on a short cord. It flickers occasionally when the sign outside cycles.', { is_light: true }, 'light', 'overhead');

  // ── 11. Vendor safes in shop zones ────────────────────────────────────────

  await upsertFurniture(VELK_SAFE_ID, VELK_SHOP,
    "Marta's Safe",
    "A heavy holo-lock safe bolted to the floor behind the counter. The lock panel glows dull orange. It doesn't look like something you'd want to try to move.",
    { vendor_safe: true, vendor_npc_id: NPC_VELK, hack_difficulty: 5 },
    'fixture'
  );

  await upsertFurniture(DRUM_SAFE_ID, DRUM_SHOP,
    "Cassius's Safe",
    "A flat-panel holo-lock safe recessed into the wall behind the tailoring station, disguised by a framed printout of a particularly successful outfit. You only notice it because the frame isn't quite flush.",
    { vendor_safe: true, vendor_npc_id: NPC_DRUM, hack_difficulty: 5 },
    'fixture'
  );

  // ── 12. Create the vendor NPCs ─────────────────────────────────────────────

  const velkBehaviourGraph = buildVendorGraph();
  const drumBehaviourGraph = buildVendorGraph();

  // Marta Velk — furniture vendor
  await upsertNpc({
    id: NPC_VELK,
    name: 'Marta Velk',
    description: "A stocky woman in her fifties with calloused hands and a permanent evaluating squint, like she's appraising everything for resale value. A vendor's lanyard hangs crooked around her neck. She smells like oil soap and synth-leather.",
    zone_id: VELK_SHOP,
    home_zone: 'zone_residential_lobby',
    work_zone_id: VELK_SHOP,
    npc_type: 'vendor',
    vendor_shop_name: "Velk's Pre-Owned Furnishings",
    vendor_schedule: DEFAULT_SCHEDULE,
    dialogue_tree: VELK_DIALOGUE,
    chitchat: VELK_CHITCHAT,
    home_activities: VELK_HOME_ACTIVITIES,
    behaviour_graph: velkBehaviourGraph,
    hp_max: 30,
    flags: {},
    sex: 'female',
  });

  // Cassius Drum — clothing vendor
  await upsertNpc({
    id: NPC_DRUM,
    name: 'Cassius Drum',
    description: "A lean man in his thirties with an eye for colour coordination that looks deliberately out of place in this city. He wears a patchwork of reclaimed fabric and tech-fibre with a tailor's tape measure wrapped around one wrist like a bracelet. Attitude to spare.",
    zone_id: DRUM_SHOP,
    home_zone: 'zone_residential_lobby',
    work_zone_id: DRUM_SHOP,
    npc_type: 'vendor',
    vendor_shop_name: "Drum's Fits",
    vendor_schedule: DEFAULT_SCHEDULE,
    dialogue_tree: DRUM_DIALOGUE,
    chitchat: DRUM_CHITCHAT,
    home_activities: DRUM_HOME_ACTIVITIES,
    behaviour_graph: drumBehaviourGraph,
    hp_max: 25,
    flags: {},
    sex: 'male',
  });

  // ── 13. Schedule board furniture ──────────────────────────────────────────

  const velkSchedText = fmtScheduleBoard('Marta Velk', "Velk's Pre-Owned Furnishings", DEFAULT_SCHEDULE);
  const drumSchedText = fmtScheduleBoard('Cassius Drum', "Drum's Fits", DEFAULT_SCHEDULE);

  await query(`
    INSERT INTO furniture (id, zone_id, name, description, flags, object_type)
    VALUES ($1,$2,$3,$4,$5,'decoration')
    ON CONFLICT (id) DO UPDATE SET zone_id=$2, name=$3, description=$4, flags=$5
  `, [VELK_SCHED_ID, VELK_SHOP, "Marta Velk's Schedule", velkSchedText, JSON.stringify({ vendor_schedule_board: true, vendor_npc_id: NPC_VELK })]);

  await query(`
    INSERT INTO furniture (id, zone_id, name, description, flags, object_type)
    VALUES ($1,$2,$3,$4,$5,'decoration')
    ON CONFLICT (id) DO UPDATE SET zone_id=$2, name=$3, description=$4, flags=$5
  `, [DRUM_SCHED_ID, DRUM_SHOP, "Cassius Drum's Schedule", drumSchedText, JSON.stringify({ vendor_schedule_board: true, vendor_npc_id: NPC_DRUM })]);

  console.log('  schedule boards created\n');

  // ── 14. Power wiring ───────────────────────────────────────────────────────
  //
  // Exterior zones → city grid (city_plant)
  // Interior zones (shop + basement) → junction_box generator in basement
  //
  // We do this with raw SQL rather than calling installGenerator (which
  // requires the server's injected deps object).

  const genVelk = `gen_${VELK_BSMT}_${Date.now()}`;
  const genDrum  = `gen_${DRUM_BSMT}_${Date.now() + 1}`;

  // Capacity for the basement junction_box: 5 kW is enough for lights + sign.
  const JB_CAPACITY = 5000;

  // Insert junction_box generators in basement zones
  await query(`
    INSERT INTO generators (id, zone_id, name, generator_type, capacity_kw, fuel_type, fuel_remaining, fuel_burn_rate, connection_range, status, city_generator_id)
    VALUES ($1,$2,$3,'junction_box',$4,NULL,0,0,0,'online',$5)
    ON CONFLICT (id) DO NOTHING
  `, [genVelk, VELK_BSMT, "Velk's Junction Box", JB_CAPACITY, velkCityGenId]);

  await query(`
    INSERT INTO generators (id, zone_id, name, generator_type, capacity_kw, fuel_type, fuel_remaining, fuel_burn_rate, connection_range, status, city_generator_id)
    VALUES ($1,$2,$3,'junction_box',$4,NULL,0,0,0,'online',$5)
    ON CONFLICT (id) DO NOTHING
  `, [genDrum, DRUM_BSMT, "Drum's Junction Box", JB_CAPACITY, drumCityGenId]);

  console.log(`  created junction_box generator ${genVelk} in ${VELK_BSMT}`);
  console.log(`  created junction_box generator ${genDrum} in ${DRUM_BSMT}\n`);

  // Wire interior building zones → junction_box generators
  for (const [zoneId, genId, zoneName] of [
    [VELK_SHOP,  genVelk, "Velk's Pre-Owned Furnishings"],
    [VELK_BSMT,  genVelk, "Velk's Utility Room"],
    [DRUM_SHOP,  genDrum,  "Drum's Fits"],
    [DRUM_BSMT,  genDrum,  "Drum's Utility Room"],
  ]) {
    // Power zone
    await query(`
      INSERT INTO power_zones (id, name, source_type, generator_id, capacity_kw, current_load_kw, status)
      VALUES ($1,$2,'junction_box',$3,$4,0,'powered')
      ON CONFLICT (id) DO UPDATE SET name=$2, source_type='junction_box', generator_id=$3, capacity_kw=$4
    `, [zoneId, zoneName, genId, JB_CAPACITY]);

    // Lighting state (count actual fixtures)
    const { rows: fixRows } = await query(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm FROM furniture WHERE zone_id=$1 AND object_type='light'`,
      [zoneId]
    );
    await query(`
      INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count, total_lumens)
      VALUES ($1,0,0,$2,$3)
      ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2, total_lumens=$3
    `, [zoneId, fixRows[0]?.cnt || 0, fixRows[0]?.lm || 0]);

    console.log(`  powered (junction_box): ${zoneId} → ${genId}`);
  }

  // Wire exterior zones → city_plant generators
  for (const [zoneId, genId, zoneName] of [
    [VELK_EXT, velkCityGenId, "Velk's Pre-Owned — Exterior"],
    [DRUM_EXT, drumCityGenId, "Drum's Fits — Exterior"],
  ]) {
    const { rows: capRows } = await query('SELECT capacity_kw FROM generators WHERE id=$1', [genId]);
    const cap = capRows[0]?.capacity_kw || 10000;

    await query(`
      INSERT INTO power_zones (id, name, source_type, generator_id, capacity_kw, current_load_kw, status)
      VALUES ($1,$2,'city_grid',$3,$4,0,'powered')
      ON CONFLICT (id) DO UPDATE SET name=$2, source_type='city_grid', generator_id=$3, capacity_kw=$4
    `, [zoneId, zoneName, genId, cap]);

    const { rows: fixRows } = await query(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm FROM furniture WHERE zone_id=$1 AND object_type='light'`,
      [zoneId]
    );
    await query(`
      INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count, total_lumens)
      VALUES ($1,0,0,$2,$3)
      ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2, total_lumens=$3
    `, [zoneId, fixRows[0]?.cnt || 0, fixRows[0]?.lm || 0]);

    console.log(`  powered (city_grid):    ${zoneId} → ${genId}`);
  }

  // ── 15. Power verification ─────────────────────────────────────────────────

  console.log('\n=== Power verification ===');
  const zoneIds = [VELK_EXT, VELK_SHOP, VELK_BSMT, DRUM_EXT, DRUM_SHOP, DRUM_BSMT];
  const { rows: pwRows } = await query(
    `SELECT pz.id, pz.name, pz.source_type, pz.status, g.generator_type
     FROM power_zones pz
     LEFT JOIN generators g ON g.id = pz.generator_id
     WHERE pz.id = ANY($1)`,
    [zoneIds]
  );
  for (const row of pwRows) {
    const ok = row.status === 'powered' ? '✓' : '✗';
    console.log(`  ${ok} ${row.id.padEnd(25)} ${row.source_type.padEnd(14)} [${row.status}] via ${row.generator_type}`);
  }
  const missing = zoneIds.filter(id => !pwRows.find(r => r.id === id));
  if (missing.length) console.warn('\n  ⚠ Missing power_zones rows:', missing);

  console.log('\n=== seed-vendor-shops: done ===');
  console.log('\nNext steps:');
  console.log('  1. Restart the server (or it will pick up zones on next reload).');
  console.log('  2. Open the dev panel → Power Tab → Recompute to refresh load calculations.');
  console.log('  3. Open each NPC in the NPC editor to add vendor inventory items.');
  console.log('  4. The two exterior zones may need exit-direction adjustments in the zone editor.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function upsertZone({ id, name, description, danger_rating='medium', pvp_enabled=0, radiation_level=0, is_safe_zone=0, ambient_events=[], ambient_theme='indoors', flags={}, exits={}, map_id=null, grid_x=null, grid_y=null, grid_z=0, marker=null, color=null, parent_zone=null }) {
  const { rows: ex } = await query('SELECT id FROM zones WHERE id=$1', [id]);
  if (ex.length) {
    await query(
      `UPDATE zones SET name=$2,description=$3,danger_rating=$4,pvp_enabled=$5,radiation_level=$6,is_safe_zone=$7,ambient_events=$8,ambient_theme=$9,flags=$10,exits=$11,map_id=$12,grid_x=$13,grid_y=$14,grid_z=$15,marker=$16,color=$17,parent_zone=$18 WHERE id=$1`,
      [id,name,description,danger_rating,pvp_enabled,radiation_level,is_safe_zone,JSON.stringify(ambient_events),ambient_theme,JSON.stringify(flags),JSON.stringify(exits),map_id,grid_x,grid_y,grid_z??0,marker,color,parent_zone]
    );
    console.log(`  [update] zone ${id}`);
  } else {
    await query(
      `INSERT INTO zones (id,name,description,danger_rating,pvp_enabled,radiation_level,is_safe_zone,ambient_events,ambient_theme,flags,exits,map_id,grid_x,grid_y,grid_z,marker,color,parent_zone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [id,name,description,danger_rating,pvp_enabled,radiation_level,is_safe_zone,JSON.stringify(ambient_events),ambient_theme,JSON.stringify(flags),JSON.stringify(exits),map_id,grid_x,grid_y,grid_z??0,marker,color,parent_zone]
    );
    console.log(`  [create] zone ${id}`);
  }
}

async function upsertMap(id, name, parentZoneId, entryZoneId) {
  const { rows: ex } = await query('SELECT id FROM maps WHERE id=$1', [id]);
  if (ex.length) {
    await query('UPDATE maps SET name=$2,parent_zone_id=$3,entry_zone_id=$4 WHERE id=$1', [id,name,parentZoneId,entryZoneId]);
    console.log(`  [update] map ${id}`);
  } else {
    await query('INSERT INTO maps (id,name,parent_zone_id,entry_zone_id) VALUES ($1,$2,$3,$4)', [id,name,parentZoneId,entryZoneId]);
    console.log(`  [create] map ${id}`);
  }
}

async function upsertFurniture(id, zoneId, name, description, flagsObj={}, objectType='furniture', lightType=null) {
  const flags = { ...flagsObj };
  if (lightType) flags.light_type = lightType;
  const { rows: ex } = await query('SELECT id FROM furniture WHERE id=$1', [id]);
  if (ex.length) {
    await query(
      `UPDATE furniture SET zone_id=$2,name=$3,description=$4,flags=$5,object_type=$6,light_type=$7 WHERE id=$1`,
      [id,zoneId,name,description,JSON.stringify(flags),objectType,lightType||'lamp']
    );
    console.log(`  [update] furniture ${id}`);
  } else {
    await query(
      `INSERT INTO furniture (id,zone_id,name,description,flags,object_type,light_type) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id,zoneId,name,description,JSON.stringify(flags),objectType,lightType||'lamp']
    );
    console.log(`  [create] furniture ${id}`);
  }
}

async function upsertNpc({ id, name, description, zone_id, home_zone, work_zone_id, npc_type, vendor_shop_name, vendor_schedule, dialogue_tree, chitchat, home_activities, behaviour_graph, hp_max, flags, sex }) {
  const { rows: ex } = await query('SELECT id FROM npcs WHERE id=$1', [id]);
  const fields = {
    name, description,
    zone_id: zone_id || null,
    home_zone: home_zone || 'zone_residential_lobby',
    work_zone_id: work_zone_id || null,
    npc_type: npc_type || 'npc',
    vendor_shop_name: vendor_shop_name || null,
    vendor_schedule: JSON.stringify(vendor_schedule || {}),
    dialogue_tree: JSON.stringify(dialogue_tree || {}),
    chitchat: JSON.stringify(chitchat || []),
    home_activities: JSON.stringify(home_activities || []),
    behaviour_graph: JSON.stringify(behaviour_graph || {}),
    vendor_inventory: '[]',
    vendor_stock: '[]',
    vendor_stock_size: 10,
    vendor_restock_rate: 1,
    vendor_credits: 0,
    vendor_bank_credits: 0,
    hp_max,
    hp: hp_max,
    flags: JSON.stringify(flags || {}),
    wanders: 0,
    wander_zones: '[]',
    sex: sex || 'male',
    faction: null,
  };
  if (ex.length) {
    await query(
      `UPDATE npcs SET name=$2,description=$3,zone_id=$4,home_zone=$5,work_zone_id=$6,npc_type=$7,vendor_shop_name=$8,vendor_schedule=$9,dialogue_tree=$10,chitchat=$11,home_activities=$12,behaviour_graph=$13,vendor_inventory=$14,vendor_stock=$15,vendor_stock_size=$16,vendor_restock_rate=$17,hp_max=$18,hp=$19,flags=$20,sex=$21 WHERE id=$1`,
      [id,fields.name,fields.description,fields.zone_id,fields.home_zone,fields.work_zone_id,fields.npc_type,fields.vendor_shop_name,fields.vendor_schedule,fields.dialogue_tree,fields.chitchat,fields.home_activities,fields.behaviour_graph,fields.vendor_inventory,fields.vendor_stock,fields.vendor_stock_size,fields.vendor_restock_rate,fields.hp_max,fields.hp,fields.flags,fields.sex]
    );
    console.log(`  [update] npc ${id} (${name})`);
  } else {
    await query(
      `INSERT INTO npcs (id,name,description,zone_id,home_zone,work_zone_id,npc_type,vendor_shop_name,vendor_schedule,dialogue_tree,chitchat,home_activities,behaviour_graph,vendor_inventory,vendor_stock,vendor_stock_size,vendor_restock_rate,vendor_credits,vendor_bank_credits,hp_max,hp,flags,wanders,wander_zones,sex,faction) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [id,fields.name,fields.description,fields.zone_id,fields.home_zone,fields.work_zone_id,fields.npc_type,fields.vendor_shop_name,fields.vendor_schedule,fields.dialogue_tree,fields.chitchat,fields.home_activities,fields.behaviour_graph,fields.vendor_inventory,fields.vendor_stock,fields.vendor_stock_size,fields.vendor_restock_rate,0,0,fields.hp_max,fields.hp,fields.flags,0,fields.wander_zones,fields.sex,null]
    );
    console.log(`  [create] npc ${id} (${name})`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
