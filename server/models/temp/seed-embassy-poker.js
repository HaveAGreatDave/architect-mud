/**
 * One-shot: add poker table + Orion Dex to the Embassy Hotel & Bar lobby.
 *
 * Creates:
 *   game_tables row   — holdem config for the Embassy table
 *   furn_embassy_poker_table  — poker table furniture
 *   furn_embassy_chair_1…4   — chairs with sit interaction
 *   npc_orion_dex             — dealer NPC, works in zone_residential_lobby
 *
 * Run once:
 *   node server/models/temp/seed-embassy-poker.js
 */

import 'dotenv/config';
import { query } from '../db.js';

const ZONE_ID  = 'zone_residential_lobby';
const TABLE_ID = 'gametable_embassy';

// ── Dealer AI graph ───────────────────────────────────────────────────────────
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
      { label: "What's this place?", next: 'place' },
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
    text: '"The Embassy. Used to be a hotel lobby. Now it\'s got a bar and a poker table, which is an improvement. The rest is none of my business."',
    options: [
      { label: 'Sounds like my kind of place.', next: 'bye' },
      { label: "I'd like to play.", next: 'play' },
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
  'watches the room with the patient attention of someone who has seen every tell twice',
  '"Side pot. Keep your stacks separate."',
  'squares the deck against the felt — a crisp, decisive sound',
  'glances toward the bar, then back at the table',
  '"House doesn\'t take a cut. Don\'t ask why."',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function upsertFurniture(id, zoneId, name, description, flagsObj = {}, objectType = 'furniture', lightType = null) {
  const { rows: ex } = await query('SELECT id FROM furniture WHERE id=$1', [id]);
  if (ex.length) {
    await query(
      'UPDATE furniture SET zone_id=$2,name=$3,description=$4,flags=$5,object_type=$6,light_type=$7 WHERE id=$1',
      [id, zoneId, name, description, JSON.stringify(flagsObj), objectType, lightType || 'lamp']
    );
    console.log(`  [update] furniture ${id}`);
  } else {
    await query(
      'INSERT INTO furniture (id,zone_id,name,description,flags,object_type,light_type) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, zoneId, name, description, JSON.stringify(flagsObj), objectType, lightType || 'lamp']
    );
    console.log(`  [create] furniture ${id}`);
  }
}

async function upsertGameTable(id, zoneId, name, config) {
  const { rows: ex } = await query('SELECT id FROM game_tables WHERE id=$1', [id]);
  if (ex.length) {
    await query(
      'UPDATE game_tables SET zone_id=$2,name=$3,config=$4,updated_at=NOW() WHERE id=$1',
      [id, zoneId, name, JSON.stringify(config)]
    );
    console.log(`  [update] game_table ${id}`);
  } else {
    await query(
      "INSERT INTO game_tables (id,zone_id,name,game_type,config,state,phase) VALUES ($1,$2,$3,'holdem',$4,'{}','WaitingForPlayers')",
      [id, zoneId, name, JSON.stringify(config)]
    );
    console.log(`  [create] game_table ${id}`);
  }
}

async function upsertNpc({ id, name, description, zone_id, home_zone, work_zone_id,
  npc_type, dialogue_tree, chitchat, behaviour_graph, hp_max, flags, sex }) {
  const { rows: ex } = await query('SELECT id FROM npcs WHERE id=$1', [id]);
  const fields = [
    name, description, zone_id || null, home_zone || 'zone_residential_lobby',
    work_zone_id || null, npc_type || 'npc', JSON.stringify(dialogue_tree || {}),
    JSON.stringify(chitchat || []), JSON.stringify(behaviour_graph || {}), hp_max, hp_max,
    JSON.stringify(flags || {}), sex || 'male',
  ];
  if (ex.length) {
    await query(
      'UPDATE npcs SET name=$2,description=$3,zone_id=$4,home_zone=$5,work_zone_id=$6,npc_type=$7,dialogue_tree=$8,chitchat=$9,behaviour_graph=$10,hp_max=$11,hp=$12,flags=$13,sex=$14 WHERE id=$1',
      [id, ...fields]
    );
    console.log(`  [update] npc ${id} (${name})`);
  } else {
    await query(
      "INSERT INTO npcs (id,name,description,zone_id,home_zone,work_zone_id,npc_type,dialogue_tree,chitchat,behaviour_graph,vendor_inventory,vendor_stock,hp_max,hp,flags,wanders,wander_zones,sex,faction) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'[]','[]',$11,$12,$13,0,'[]',$14,null)",
      [id, ...fields]
    );
    console.log(`  [create] npc ${id} (${name})`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== seed-embassy-poker: starting ===\n');

  // game_tables row
  await upsertGameTable(TABLE_ID, ZONE_ID, 'Embassy Poker Table', {
    smallBlind: 10,
    bigBlind: 20,
    buyIn: 200,
    minBuyIn: 100,
    maxBuyIn: 1000,
    turnTimerSecs: 30,
    autoStartDelaySecs: 12,
  });

  // Poker table furniture
  await upsertFurniture(
    'furn_embassy_poker_table', ZONE_ID,
    'Poker Table',
    "A full-size poker table wedged into the corner of the lobby, green felt worn smooth at the betting line. Someone put it here years ago and it never left. A dealer's tray sits at the north end, clean and ready.",
    { game_table_id: TABLE_ID, interactions: ['examine'] }
  );

  // 4 chairs
  const chairDescs = [
    "A heavy wooden chair dragged in from somewhere upstairs. It's solid, which is more than you can say for most things here.",
    'A padded stool with a welded back — improvised, but it works. The cushion has seen better decades.',
    'An old armchair with the arms sawn off to fit at the table. Surprisingly comfortable.',
    'A folding chair that has been here so long it no longer folds. The hinge is fused shut with age.',
  ];
  for (let i = 1; i <= 4; i++) {
    await upsertFurniture(
      `furn_embassy_chair_${i}`, ZONE_ID,
      `Chair ${i}`,
      chairDescs[i - 1],
      { interactions: ['sit'], game_table_id: TABLE_ID, seat_idx: i - 1 }
    );
  }

  // Orion Dex
  await upsertNpc({
    id: 'npc_orion_dex',
    name: 'Orion Dex',
    description: "A lean man of indeterminate age in a black shirt, rolled to the elbows. His hands are always moving — shuffling, squaring a deck, tapping the felt — with a precision that suggests either training or compulsion. He watches the room with an expression that gives nothing away. A dealer's badge is pinned to his shirt: hand-printed, slightly crooked.",
    zone_id: ZONE_ID,
    home_zone: ZONE_ID,
    work_zone_id: ZONE_ID,
    npc_type: 'dealer',
    dialogue_tree: DEALER_DIALOGUE,
    chitchat: DEALER_CHITCHAT,
    behaviour_graph: buildDealerGraph(),
    hp_max: 25,
    flags: { table_id: TABLE_ID },
    sex: 'male',
  });

  console.log('\n=== seed-embassy-poker: done ===');
  console.log('\nNext: restart server, go to Embassy Hotel & Bar lobby, type: join');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
