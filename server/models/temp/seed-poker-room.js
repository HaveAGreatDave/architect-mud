/**
 * One-shot: create the Painted Revolver poker room.
 *
 * Creates:
 *   zone_poker_exterior    — street-level exterior (wired to world map)
 *   zone_poker_room        — interior, the actual table room
 *   furniture:
 *     furn_poker_table     — the poker table (flags: game_table_id)
 *     furn_poker_chair_1…4 — chairs (sit interaction)
 *     furn_poker_light     — overhead light
 *     furn_poker_bar       — back-bar counter
 *   game_tables row        — holdem table config
 *   npc_orion_dex          — dealer NPC with AI graph and chitchat
 *
 * Run once:
 *   node server/models/temp/seed-poker-room.js
 */

import 'dotenv/config';
import { query } from '../db.js';
import { randomUUID } from 'crypto';

// ── Fixed IDs ─────────────────────────────────────────────────────────────────
const ZONE_EXT  = 'zone_poker_exterior';
const ZONE_ROOM = 'zone_poker_room';
const NPC_DEALER = 'npc_orion_dex';
const TABLE_ID   = 'gametable_painted_revolver';

const FURN_TABLE    = 'furn_poker_table';
const FURN_CHAIR_1  = 'furn_poker_chair_1';
const FURN_CHAIR_2  = 'furn_poker_chair_2';
const FURN_CHAIR_3  = 'furn_poker_chair_3';
const FURN_CHAIR_4  = 'furn_poker_chair_4';
const FURN_LIGHT    = 'furn_poker_light';
const FURN_BAR      = 'furn_poker_bar';

// ── Dealer AI graph ───────────────────────────────────────────────────────────
// Orion stays at the table zone (work_zone_id = ZONE_ROOM).
// He checks for players, chitchats if present, then waits.
// The gametable plugin drives actual game events — this graph is pure atmosphere.
function buildDealerGraph() {
  return {
    _start: 'start',
    nodes: {
      start:        { type: 'start', next: 'player_check' },
      player_check: { type: 'condition', condition_type: 'PLAYER_IN_ZONE', ifTrue: 'chitchat', ifFalse: 'idle_wait' },
      chitchat:     { type: 'action', action_type: 'VENDOR_CHITCHAT', next: 'chat_wait' },
      chat_wait:    { type: 'wait', seconds: 90, next: 'start' },
      idle_wait:    { type: 'wait', seconds: 30, next: 'start' },
    },
  };
}

// ── Dialogue ──────────────────────────────────────────────────────────────────
const DEALER_DIALOGUE = {
  root: {
    text: "Orion Dex doesn't look up from the cards he's riffle-shuffling. \"You're either here to play or you're in the way. Which is it?\"",
    options: [
      { label: "I'd like to play.", next: 'play' },
      { label: 'Tell me the rules.', next: 'rules' },
      { label: 'What\'s this place?', next: 'place' },
      { label: 'Just looking.', next: 'bye' },
    ],
  },
  play: {
    text: '"Then sit down and type join. Buy-in\'s posted on the table. Don\'t splash the pot."',
    options: [
      { label: 'How do I bet?', next: 'betting' },
      { label: 'Got it. Thanks.', next: 'bye' },
    ],
  },
  rules: {
    text: '"Texas Hold\'em. Two hole cards, five community. Best hand wins. Blinds are posted automatically. If you fold every hand you\'ll last longer but win nothing."',
    options: [
      { label: 'How do I bet?', next: 'betting' },
      { label: 'What commands do I use?', next: 'commands' },
      { label: 'Ready to play.', next: 'play' },
    ],
  },
  betting: {
    text: '"check, call, bet X, raise X, fold, allin. The system enforces minimum raises. Don\'t waste my time asking what the minimum is — it\'ll tell you."',
    options: [
      { label: 'What commands are there?', next: 'commands' },
      { label: 'Ready.', next: 'bye' },
    ],
  },
  commands: {
    text: '"join — sit down. leave — cash out and go. check / call / bet X / raise X / fold / allin — in-hand actions. board — see community cards. pot — current pot. players — who\'s in and their stacks."',
    options: [
      { label: 'Got it.', next: 'bye' },
    ],
  },
  place: {
    text: '"The Painted Revolver. Private game. Semi-legal. The city looks the other way because someone upstairs likes cards. Don\'t ask who — they like their privacy more than they like cards."',
    options: [
      { label: 'Sounds like my kind of place.', next: 'bye' },
      { label: 'I\'d like to play.', next: 'play' },
    ],
  },
  bye: {
    text: '"Seat\'s waiting."',
    options: [],
  },
};

// ── Chitchat pool ─────────────────────────────────────────────────────────────
const DEALER_CHITCHAT = [
  '"Pot\'s right."',
  'cuts the deck without looking, a motion as automatic as breathing',
  '"No rabbit hunting."',
  'sets out the cut card with a flat click',
  '"Your read or your math — pick one. You\'re not fast enough for both."',
  'riffles the deck once, sets it down, waits',
  '"Minimum raise is the size of the last raise. Always."',
  'adjusts the position of the discard tray by exactly one centimeter',
  '"If you can\'t afford to call, you shouldn\'t have raised."',
  'watches the table with the patient attention of someone who has seen every tell twice',
  '"Side pot. Keep your stacks separate."',
  'squares the deck against the felt — a crisp, decisive sound',
];

// ── DB helpers ────────────────────────────────────────────────────────────────

async function upsertZone({ id, name, description, danger_rating='safe', pvp_enabled=0,
  radiation_level=0, is_safe_zone=1, ambient_events=[], ambient_theme='indoors',
  flags={}, exits={}, map_id=null, grid_x=null, grid_y=null, grid_z=0,
  marker=null, color=null, parent_zone=null }) {
  const { rows: ex } = await query('SELECT id FROM zones WHERE id=$1', [id]);
  const vals = [id,name,description,danger_rating,pvp_enabled,radiation_level,is_safe_zone,
    JSON.stringify(ambient_events),ambient_theme,JSON.stringify(flags),JSON.stringify(exits),
    map_id,grid_x,grid_y,grid_z??0,marker,color,parent_zone];
  if (ex.length) {
    await query(`UPDATE zones SET name=$2,description=$3,danger_rating=$4,pvp_enabled=$5,radiation_level=$6,is_safe_zone=$7,ambient_events=$8,ambient_theme=$9,flags=$10,exits=$11,map_id=$12,grid_x=$13,grid_y=$14,grid_z=$15,marker=$16,color=$17,parent_zone=$18 WHERE id=$1`, vals);
    console.log(`  [update] zone ${id}`);
  } else {
    await query(`INSERT INTO zones (id,name,description,danger_rating,pvp_enabled,radiation_level,is_safe_zone,ambient_events,ambient_theme,flags,exits,map_id,grid_x,grid_y,grid_z,marker,color,parent_zone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, vals);
    console.log(`  [create] zone ${id}`);
  }
}

async function upsertFurniture(id, zoneId, name, description, flagsObj={}, objectType='furniture', lightType=null) {
  const flags = { ...flagsObj };
  const { rows: ex } = await query('SELECT id FROM furniture WHERE id=$1', [id]);
  if (ex.length) {
    await query(`UPDATE furniture SET zone_id=$2,name=$3,description=$4,flags=$5,object_type=$6,light_type=$7 WHERE id=$1`,
      [id,zoneId,name,description,JSON.stringify(flags),objectType,lightType||'lamp']);
    console.log(`  [update] furniture ${id}`);
  } else {
    await query(`INSERT INTO furniture (id,zone_id,name,description,flags,object_type,light_type) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id,zoneId,name,description,JSON.stringify(flags),objectType,lightType||'lamp']);
    console.log(`  [create] furniture ${id}`);
  }
}

async function upsertGameTable(id, zoneId, name, config) {
  const { rows: ex } = await query('SELECT id FROM game_tables WHERE id=$1', [id]);
  if (ex.length) {
    await query(`UPDATE game_tables SET zone_id=$2,name=$3,config=$4,updated_at=NOW() WHERE id=$1`,
      [id,zoneId,name,JSON.stringify(config)]);
    console.log(`  [update] game_table ${id}`);
  } else {
    await query(`INSERT INTO game_tables (id,zone_id,name,game_type,config,state,phase) VALUES ($1,$2,$3,'holdem',$4,'{}','WaitingForPlayers')`,
      [id,zoneId,name,JSON.stringify(config)]);
    console.log(`  [create] game_table ${id}`);
  }
}

async function upsertNpc({ id, name, description, zone_id, home_zone, work_zone_id,
  npc_type, dialogue_tree, chitchat, behaviour_graph, hp_max, flags, sex }) {
  const { rows: ex } = await query('SELECT id FROM npcs WHERE id=$1', [id]);
  const fields = [
    name, description, zone_id||null, home_zone||'zone_residential_lobby',
    work_zone_id||null, npc_type||'npc', JSON.stringify(dialogue_tree||{}),
    JSON.stringify(chitchat||[]), JSON.stringify(behaviour_graph||{}), hp_max, hp_max,
    JSON.stringify(flags||{}), sex||'male',
  ];
  if (ex.length) {
    await query(`UPDATE npcs SET name=$2,description=$3,zone_id=$4,home_zone=$5,work_zone_id=$6,npc_type=$7,dialogue_tree=$8,chitchat=$9,behaviour_graph=$10,hp_max=$11,hp=$12,flags=$13,sex=$14 WHERE id=$1`,
      [id, ...fields]);
    console.log(`  [update] npc ${id} (${name})`);
  } else {
    await query(`INSERT INTO npcs (id,name,description,zone_id,home_zone,work_zone_id,npc_type,dialogue_tree,chitchat,behaviour_graph,vendor_inventory,vendor_stock,hp_max,hp,flags,wanders,wander_zones,sex,faction) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'[]','[]',$11,$12,$13,0,'[]',$14,null)`,
      [id, ...fields]);
    console.log(`  [create] npc ${id} (${name})`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== seed-poker-room: starting ===\n');

  // 1. Place the exterior deterministically next to a fixed anchor zone, so the
  //    room always lands in the same spot regardless of DB row order.
  //    To relocate the Painted Revolver, change ANCHOR_ID / PREFERRED_DIRS below.
  const ANCHOR_ID = 'zone_city_ne';                    // Custodian Row — a fitting back-alley
  const PREFERRED_DIRS = ['east', 'south', 'north', 'west']; // sit beside the anchor, this order

  const { rows: worldZones } = await query(
    `SELECT id,name,grid_x,grid_y,exits FROM zones WHERE map_id='map_world' AND grid_x IS NOT NULL AND grid_y IS NOT NULL`
  );
  if (!worldZones.length) throw new Error('No world map zones found.');

  const anchor = worldZones.find(z => z.id === ANCHOR_ID);
  if (!anchor) throw new Error(`Anchor zone ${ANCHOR_ID} not found on map_world — pick a different ANCHOR_ID.`);

  const taken = new Set(worldZones.map(z => `${z.grid_x},${z.grid_y}`));
  const DIR = { north: [0,-1], south: [0,1], east: [1,0], west: [-1,0] };
  let extPos = null;
  for (const dir of PREFERRED_DIRS) {
    const [dx, dy] = DIR[dir];
    const key = `${anchor.grid_x + dx},${anchor.grid_y + dy}`;
    if (!taken.has(key)) { extPos = { x: anchor.grid_x + dx, y: anchor.grid_y + dy }; break; }
  }
  if (!extPos) throw new Error(`No open cell adjacent to ${ANCHOR_ID} (${anchor.name}).`);
  console.log(`Exterior grid → (${extPos.x}, ${extPos.y}) — beside ${anchor.name}\n`);

  // 2. Create interior map
  const { rows: mapEx } = await query('SELECT id FROM maps WHERE id=$1', ['map_int_poker']);
  if (!mapEx.length) {
    await query(`INSERT INTO maps (id,name,parent_zone_id,entry_zone_id) VALUES ('map_int_poker','The Painted Revolver — Interior',$1,$2)`,
      [ZONE_EXT, ZONE_ROOM]);
    console.log('  [create] map map_int_poker');
  }

  // 3. Exterior zone
  const extExits = { in: ZONE_ROOM };
  for (const [dir,[dx,dy]] of Object.entries({north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]})) {
    const nb = worldZones.find(z => z.grid_x===extPos.x+dx && z.grid_y===extPos.y+dy);
    if (nb) extExits[dir] = nb.id;
  }
  await upsertZone({
    id: ZONE_EXT,
    name: 'Painted Revolver — Entrance',
    description: "A narrow door set into a blank wall, the kind that doesn't invite questions. Above it, a hand-stencilled revolver is painted directly onto the concrete in faded red — no sign, no hours. The city noise doesn't reach this far down the alley.",
    danger_rating: 'low',
    ambient_theme: 'outdoors',
    flags: { is_building: true },
    exits: extExits,
    map_id: 'map_world',
    grid_x: extPos.x,
    grid_y: extPos.y,
    marker: 'Pv',
    color: '#8b3a3a',
  });

  // Wire reverse exits on adjacent world-map zones
  const OPP = { north:'south',south:'north',east:'west',west:'east' };
  for (const [dir,[dx,dy]] of Object.entries({north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]})) {
    const nb = worldZones.find(z => z.grid_x===extPos.x+dx && z.grid_y===extPos.y+dy);
    if (!nb) continue;
    const nbExits = typeof nb.exits==='string' ? JSON.parse(nb.exits) : (nb.exits||{});
    const rev = OPP[dir];
    if (!nbExits[rev]) {
      nbExits[rev] = ZONE_EXT;
      await query('UPDATE zones SET exits=$1 WHERE id=$2',[JSON.stringify(nbExits),nb.id]);
      console.log(`  wired ${nb.id}.exits.${rev} → ${ZONE_EXT}`);
    }
  }

  // 4. Interior room zone
  await upsertZone({
    id: ZONE_ROOM,
    name: 'The Painted Revolver',
    description: "The room is low-ceilinged and deliberately dim — a single overhead lamp throws a hard cone of light directly onto a green-felt poker table at the center, leaving the edges in comfortable shadow. Four mismatched chairs are pulled up to the table. A long bar runs along the back wall, mostly bottles and a water tap. No windows. No music. The only sounds are the felt and whatever's in your head.",
    danger_rating: 'safe',
    is_safe_zone: 1,
    ambient_theme: 'indoors',
    flags: { is_interior: true },
    exits: { out: ZONE_EXT },
    map_id: 'map_int_poker',
    grid_x: 0,
    grid_y: 0,
    parent_zone: ZONE_EXT,
    ambient_events: [
      'The felt absorbs sound like a held breath.',
      'A chip clicks against the edge of the table.',
      'The overhead light makes no promises.',
      'Somewhere in the building, a pipe knocks twice and goes quiet.',
      'The air smells faintly of recycled air and old decisions.',
      'A card lands without ceremony.',
    ],
  });

  // 5. game_tables row
  await upsertGameTable(TABLE_ID, ZONE_ROOM, 'The Painted Revolver', {
    smallBlind: 10,
    bigBlind: 20,
    buyIn: 200,
    minBuyIn: 100,
    maxBuyIn: 1000,
    turnTimerSecs: 30,
    autoStartDelaySecs: 12,
  });

  // 6. Furniture
  await upsertFurniture(FURN_TABLE, ZONE_ROOM,
    'Poker Table',
    'A full-sized poker table with worn green felt, a padded leather rail, and a dealer\'s station at the north end. The surface is impeccably clean despite everything else in this place. A white line marks the betting edge.',
    { game_table_id: TABLE_ID, interactions: ['examine'] },
    'furniture'
  );

  const chairDesc = [
    'A heavy wooden chair with a cracked leather cushion. It faces the table directly — no comfortable angle, no escape route.',
    'A stool converted into a proper seat with salvaged padding and cable ties. Unexpectedly solid.',
    'A padded folding chair that has been folded so many times its hinges have given up and fused. It\'s just a chair now.',
    'An old barstool with a back welded on, the weld clearly amateur but effective. The seat is worn smooth.',
  ];
  for (let i = 1; i <= 4; i++) {
    await upsertFurniture(`furn_poker_chair_${i}`, ZONE_ROOM,
      `Chair ${i}`,
      chairDesc[i - 1],
      { interactions: ['sit'], game_table_id: TABLE_ID, seat_idx: i - 1 },
      'furniture'
    );
  }

  await upsertFurniture(FURN_LIGHT, ZONE_ROOM,
    'Overhead Lamp',
    'A single high-wattage bulb on a short pendant, aimed directly at the table. Everything outside its cone is a suggestion.',
    { is_light: true },
    'light',
    'overhead'
  );

  await upsertFurniture(FURN_BAR, ZONE_ROOM,
    'Bar Counter',
    'A long counter along the back wall: a row of bottles with handwritten labels, a tap that runs cold water, and two clean glasses. Nothing is served here — you help yourself or you don\'t drink.',
    { interactions: ['examine'] },
    'furniture'
  );

  // 7. Dealer NPC
  await upsertNpc({
    id: NPC_DEALER,
    name: 'Orion Dex',
    description: "A lean man of indeterminate age dressed in a black shirt, rolled to the elbows. His hands are always doing something — shuffling, squaring a deck, tapping the felt — with a precision that suggests either training or compulsion. He watches the table with an expression that gives nothing away. A dealer's badge is pinned to his shirt: hand-printed, slightly crooked.",
    zone_id: ZONE_ROOM,
    home_zone: 'zone_residential_lobby',
    work_zone_id: ZONE_ROOM,
    npc_type: 'dealer',
    dialogue_tree: DEALER_DIALOGUE,
    chitchat: DEALER_CHITCHAT,
    behaviour_graph: buildDealerGraph(),
    hp_max: 25,
    flags: { table_id: TABLE_ID },
    sex: 'male',
  });

  console.log('\n=== seed-poker-room: done ===');
  console.log('\nNext steps:');
  console.log('  1. Run:  node server/models/schema.js  (or npm run db:schema) to apply game_tables DDL.');
  console.log('  2. Restart the server.');
  console.log('  3. Walk to Custodian Row (zone_city_ne), then: east → in → The Painted Revolver.');
  console.log('  4. Type:  join');
  console.log('  5. Have a second player join from another terminal, then the hand auto-starts.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
