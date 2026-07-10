/**
 * Content: Deacon Voss, the bouncer on the Cherry Pit floor.
 *
 * He enforces exactly one rule — hands off the dancers — and the strippers plugin
 * does the enforcing off his flags (see the `mis.npc_act` listener there):
 *   • flags.bouncer=true            — marks him as the enforcer in this room
 *   • flags.bouncer_eject_zone      — where a repeat offender gets tossed
 * Touch a dancer on the floor and he grabs you and barks a warning; do it again
 * and he walks you out to the street. A VIP/mis_ok room is exempt — he doesn't
 * care and won't discuss what happens behind that door.
 *
 * Personality 'guard' (mis_attack) means groping HIM starts a fight, not a flee.
 * Stationary behaviour graph (no movement node) so he never leaves the door.
 *
 * Idempotent: ON CONFLICT DO UPDATE. One-shot content seed, NOT a boot migration.
 *   Local:  node scripts/add-cherry-bouncer.js
 *   Prod:   node --env-file=.env.prod scripts/add-cherry-bouncer.js
 * Then reload the world (/world/reload) or restart so he goes live.
 */
import { query } from '../server/models/db.js';

const ZONE = 'zone_mq_cherry_floor';
const EJECT_TO = 'zone_mq_cathode'; // the street outside the Glass Cherry Entrance

// Terse by design. He deflects every VIP question — it is deliberately never
// explained here what the red room is for — and restates the one rule.
const DIALOGUE = {
  root: {
    text: "A slab of a man parked at the edge of the light, arms folded, earpiece curling down behind a collar built like a doorframe. He watches the room the way a camera does — no heat, no hurry, everything. When you slow down his eyes find you and stay there. \"Something you need.\" Not really a question.",
    options: [
      { text: "\"What're the rules in here?\"", next: 'rules' },
      { text: "\"What goes on in the VIP room?\"", next: 'vip' },
      { text: "\"How do I get into VIP?\"", next: 'vip' },
      { text: "\"Nothing. Just looking.\"", actions: [{ action: 'END_CONVERSATION' }] },
    ],
  },
  rules: {
    text: "\"One rule.\" He says it like he's said it ten thousand times, because he has. \"You don't touch the dancers. You look, you tip, you keep your hands to yourself. That's the whole list.\" A beat. \"You put a hand on one of my girls out here, I put a hand on you. Once to warn you. After that you're on the pavement. We clear?\"",
    options: [
      { text: "\"Crystal.\"", actions: [{ action: 'END_CONVERSATION' }] },
      { text: "\"And VIP?\"", next: 'vip' },
    ],
  },
  vip: {
    text: "The folded arms don't move. \"What happens behind that door isn't mine to talk about, and it isn't yours to ask me.\" He nods once at the dancers working the rail. \"You want the red room, that's between you and them — spend enough and they'll tell you themselves. Out here on my floor?\" The eyes flatten. \"Hands off. That part I'll talk about all night.\"",
    options: [
      { text: "\"Fine, fine. No touching.\"", actions: [{ action: 'END_CONVERSATION' }] },
      { text: "\"What are the rules again?\"", next: 'rules' },
    ],
  },
};

// Stationary: no movement node, so ensureBehaviourGraph never gives him a walking
// default. He holds the door, scans, folds his arms, and loops.
const BEHAVIOUR = {
  _start: 'start',
  nodes: {
    start: { type: 'start', next: 'wait' },
    wait: { type: 'wait', seconds: 70, next: 'pick' },
    pick: {
      type: 'random',
      branches: [{ weight: 3 }, { weight: 1 }, { weight: 1 }, { weight: 1 }],
      branch_0: 'loop', branch_1: 'e_scan', branch_2: 'e_fold', branch_3: 'e_ear',
    },
    e_scan: { type: 'action', action_type: 'EMOTE', params: { message: "sweeps the room once with a slow, flat stare, then settles back." }, next: 'loop' },
    e_fold: { type: 'action', action_type: 'EMOTE', params: { message: "shifts his weight, refolds his arms, and doesn't otherwise move." }, next: 'loop' },
    e_ear: { type: 'action', action_type: 'EMOTE', params: { message: "presses two fingers to his earpiece, listens to nothing, and nods once." }, next: 'loop' },
    loop: { type: 'loop', next: 'start' },
  },
};

const NPC = {
  id: 'npc_cherry_bouncer',
  name: 'Deacon Voss',
  description: "A wall of a man in a black bomber jacket that gave up trying to contain his shoulders. A coiled earpiece wire disappears into his collar; steel-toed boots are planted like he was poured into the floor. He isn't looking at anything in particular, which somehow means he's looking at everything — and his hands, big and still at his sides, have obviously done this work a long time.",
  sex: 'male',
  zone_id: ZONE,
  dialogue_tree: DIALOGUE,
  behaviour_graph: BEHAVIOUR,
  flags: {
    bouncer: true,
    bouncer_eject_zone: EJECT_TO,
    personality: 'guard',   // mis_attack: grope him and he swings, not flees
    mis_willing: false,
    clothing_layers: [
      'a black bomber jacket stretched drum-tight over his shoulders',
      'a coiled earpiece with a curl of wire down the collar',
      'scuffed steel-toed boots',
    ],
  },
};

async function main() {
  const { rows } = await query('SELECT id FROM zones WHERE id=$1', [ZONE]);
  if (!rows.length) { console.error(`✗ zone ${ZONE} not found — is the world seeded?`); process.exit(1); }

  await query(
    `INSERT INTO npcs (id,name,description,zone_id,home_zone,dialogue_tree,behaviour_graph,flags,sex)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET name=$2,description=$3,zone_id=$4,home_zone=$4,dialogue_tree=$5,
       behaviour_graph=$6,flags=$7,sex=$8,work_zone_id=NULL`,
    [NPC.id, NPC.name, NPC.description, NPC.zone_id, JSON.stringify(NPC.dialogue_tree),
     JSON.stringify(NPC.behaviour_graph), JSON.stringify(NPC.flags), NPC.sex]
  );
  console.log(`✓ npc ${NPC.id} (${NPC.name}) → ${ZONE}, ejects to ${EJECT_TO}`);
  console.log('\nDone. Reload the world (/world/reload) or restart so the bouncer goes live.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
