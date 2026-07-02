/**
 * One-shot: add Cassius "Cash" Vane — the gambler NPC who plays poker against
 * human players — to the Embassy Hotel & Bar lobby (where the Embassy table is).
 *
 * Phase 1 scope: Cash stands in the room with an idle behaviour graph. A player
 * summons him with `deal in cash` / `summon cash` / `call cash`, he takes an open
 * seat, buys in from his bankroll, and plays (check-or-fold for now). Phase 2+
 * add real strategy, table talk, wandering the district, and walk-in-on-summon.
 *
 * Identity lives in flags:
 *   poker_player   — marks him as a summonable opponent
 *   poker_persona  — authored strategy/voice knobs (see design)
 *   poker_bankroll — mutable stake; the engine debits/credits this as he plays
 *
 * Run once:
 *   node server/models/temp/seed-poker-gambler.js
 */

import 'dotenv/config';
import { query } from '../db.js';

const ZONE_ID = 'zone_residential_lobby'; // Embassy lobby — has gametable_embassy
const NPC_ID  = 'npc_cash_vane';

function buildLifeGraph() {
  // He has a life: drifts toward his home haunt and hangs about there, chatting
  // up whoever's around. When summoned, the gametable plugin freezes this graph
  // and walks him to the table itself (see GameTable.summonBot).
  return {
    _start: 'start',
    nodes: {
      start:      { type: 'start', next: 'have_life' },
      have_life:  { type: 'action', action_type: 'HAVE_LIFE', next: 'home_check' },
      home_check: { type: 'condition', condition_type: 'AT_HOME', ifTrue: 'home_life', ifFalse: 'wait' },
      home_life:  { type: 'action', action_type: 'AT_HOME_LIFE', next: 'wait' },
      wait:       { type: 'wait', seconds: 20, next: 'start' },
    },
  };
}

const CHITCHAT = [
  '"Anybody feel like donating some credits? I take cards, cash, and bad decisions."',
  'shuffles a battered deck one-handed, watching the room',
  '"You look like a caller. I like callers."',
  'taps two chips together in a slow, patient rhythm',
  '"Sit down. The felt won\'t bite. Much."',
  'rolls a chip across his knuckles and pockets it without looking',
];

const PERSONA = {
  tightness:     0.5,   // folds marginal hands about half the time
  aggression:    0.7,   // leans raise over call
  bluffFreq:     0.18,  // fires with air ~18% of eligible spots
  semiBluffFreq: 0.4,   // raises draws ~40% of the time
  betSizing:     0.6,   // ~60% pot when betting
  tiltProne:     0.35,  // loosens up after a bad beat
  chattiness:    0.6,   // how often he talks
  buyIn:         200,   // matches the Embassy table buy-in
};

async function upsertNpc({ id, name, description, zone_id, home_zone, npc_type,
  chitchat, behaviour_graph, hp_max, flags, sex }) {
  const { rows: ex } = await query('SELECT id FROM npcs WHERE id=$1', [id]);
  const fields = [
    name, description, zone_id || null, home_zone || 'zone_residential_lobby',
    npc_type || 'npc', JSON.stringify(chitchat || []),
    JSON.stringify(behaviour_graph || {}), hp_max, hp_max,
    JSON.stringify(flags || {}), sex || 'male',
  ];
  if (ex.length) {
    await query(
      'UPDATE npcs SET name=$2,description=$3,zone_id=$4,home_zone=$5,npc_type=$6,chitchat=$7,behaviour_graph=$8,hp_max=$9,hp=$10,flags=$11,sex=$12 WHERE id=$1',
      [id, ...fields]
    );
    console.log(`  [update] npc ${id} (${name})`);
  } else {
    await query(
      "INSERT INTO npcs (id,name,description,zone_id,home_zone,npc_type,chitchat,behaviour_graph,vendor_inventory,vendor_stock,hp_max,hp,flags,wanders,wander_zones,sex,faction) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'[]','[]',$9,$10,$11,0,'[]',$12,null)",
      [id, ...fields]
    );
    console.log(`  [create] npc ${id} (${name})`);
  }
}

async function main() {
  console.log('=== seed-poker-gambler: starting ===\n');

  // Give him a home haunt next door to the table, so he lives *near* the game
  // rather than at it — and visibly walks in when summoned. Falls back to the
  // table zone itself if the lobby has no usable exit.
  const { rows: zr } = await query('SELECT exits FROM zones WHERE id=$1', [ZONE_ID]);
  const exits = zr[0] ? (typeof zr[0].exits === 'string' ? JSON.parse(zr[0].exits) : zr[0].exits || {}) : {};
  const neighbours = Object.values(exits).filter(Boolean);
  let homeZone = ZONE_ID;
  if (neighbours.length) {
    const { rows: valid } = await query('SELECT id FROM zones WHERE id = ANY($1)', [neighbours]);
    if (valid.length) homeZone = valid[0].id;
  }
  console.log(`Cash's home haunt → ${homeZone}${homeZone === ZONE_ID ? ' (no neighbour found; lives at the table zone)' : ''}\n`);

  await upsertNpc({
    id: NPC_ID,
    name: 'Cassius Vane',
    description: "A rangy man in a salvaged casino-floor coat, the felt-green lining worn to grey. His jaw is chrome from the cheekbone down — an old repair he never bothered to skin over, so it catches the light when he smiles, which is often and rarely means anything good. He watches hands the way other people watch weather. They call him Cash, mostly because he keeps taking it.",
    zone_id: homeZone,
    home_zone: homeZone,
    npc_type: 'gambler',
    chitchat: CHITCHAT,
    behaviour_graph: buildLifeGraph(),
    hp_max: 25,
    sex: 'male',
    flags: {
      poker_player: true,
      poker_persona: PERSONA,
      poker_bankroll: 4000,
    },
  });

  console.log('\n=== seed-poker-gambler: done ===');
  console.log('\nNext: restart the server, go to the Embassy lobby, sit at the table');
  console.log('(type: join), then summon Cash with:  deal in cash');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
