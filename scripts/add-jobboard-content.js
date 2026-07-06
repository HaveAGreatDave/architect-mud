/**
 * Content: the Franchise Strip job board.
 *
 * Seeds the "legal early money" path in zone_city_west (Franchise Strip):
 *   - 5 repeatable, non-combat "gig" quests (visit errands to existing neighbours)
 *   - a job_boards row pooling them (3 rotate at a time, every 6h)
 *   - the job board itself (furniture) + Marta Kell, the dispatcher behind the wire
 *     mesh, whose dialogue is the first philosophical encounter: each creed you pick
 *     quietly moves a faction and the hidden Architect axis (once)
 *   - extra desperation ambience on the zone
 *
 * Idempotent: ON CONFLICT DO UPDATE, so re-running re-applies edits. This is a
 * one-shot content seed, NOT a boot migration.
 *
 *   Local:  node scripts/add-jobboard-content.js
 *   Prod:   node --env-file=.env.prod scripts/add-jobboard-content.js
 *
 * Then reload the world (dev panel → /world/reload) or restart so the new NPC,
 * furniture, and board go live.
 */
import { query } from '../server/models/db.js';

const ZONE = 'zone_city_west';

// --- 6 gig quests (repeatable, visit-based so they work in safe/no-spawn zones) ----
// Each is a legal, non-combat delivery CIRCUIT: a chain of ordered `visit` legs that
// walks the player through the civilian core and back to Marta's window to claim.
// Pay scales with the round-trip distance actually walked (~2.5₵ per tile, back to the
// Strip included), so a longer run earns more — none of them is a one-hop payday. All
// legs are safe zones (danger safe/low): easy work that simply takes some legwork.
// Ordered via `requires` (a leg stays locked until its predecessor is stamped), so the
// route is walked in sequence, not teleport-skipped.
const QUESTS = [
  {
    id: 'quest_fs_meter', name: 'Meter Reading', credits: 10,
    description: 'Read the dead meters at the Threshold, then the dead meters up at Plaza North, and copy down numbers no one will ever check. 10₵.',
    objectives: [
      { id: 'o0', type: 'visit', zone: 'zone_threshold', desc: 'Read the meters at the Threshold' },
      { id: 'o1', type: 'visit', zone: 'zone_city_north', desc: 'Read the meters at Plaza North', requires: ['o0'] },
    ],
  },
  {
    id: 'quest_fs_count', name: 'Shrinkage Count', credits: 10,
    description: 'Count the Loading Bay stock, then walk the Rust Quarter cache and tally how much has walked off on its own. 10₵.',
    objectives: [
      { id: 'o0', type: 'visit', zone: 'zone_city_east', desc: 'Count stock at the Loading Bay' },
      { id: 'o1', type: 'visit', zone: 'zone_outskirts', desc: 'Tally the Rust Quarter cache', requires: ['o0'] },
    ],
  },
  {
    id: 'quest_fs_line', name: 'Hold a Place', credits: 15,
    description: "Hold a place in the line at the Sprawl Gate, then carry the ticket down to the Under Entrance for someone who matters more than you. 15₵.",
    objectives: [
      { id: 'o0', type: 'visit', zone: 'zone_city_south', desc: 'Hold the place at the Sprawl Gate' },
      { id: 'o1', type: 'visit', zone: 'zone_city_sw', desc: 'Carry the ticket to the Under Entrance', requires: ['o0'] },
    ],
  },
  {
    id: 'quest_fs_parcel', name: 'Parcel Run', credits: 15,
    description: "Carry a sealed parcel out through the Threshold and Threshold East to a drop on Castoff Walk. Don't shake it, don't open it, don't ask. 15₵.",
    objectives: [
      { id: 'o0', type: 'visit', zone: 'zone_threshold', desc: 'Through the Threshold' },
      { id: 'o1', type: 'visit', zone: 'zone_thresholdeast', desc: 'Through Threshold East', requires: ['o0'] },
      { id: 'o2', type: 'visit', zone: 'zone_velk_exterior', desc: 'Drop the parcel on Castoff Walk', requires: ['o1'] },
    ],
  },
  {
    id: 'quest_fs_loop', name: 'The Loop', credits: 20,
    description: 'The full delivery loop: Threshold, Threshold East, Castoff Walk, and out to the Marquee — in that order or not at all. 20₵.',
    objectives: [
      { id: 'o0', type: 'visit', zone: 'zone_threshold', desc: 'Threshold' },
      { id: 'o1', type: 'visit', zone: 'zone_thresholdeast', desc: 'Threshold East', requires: ['o0'] },
      { id: 'o2', type: 'visit', zone: 'zone_velk_exterior', desc: 'Castoff Walk', requires: ['o1'] },
      { id: 'o3', type: 'visit', zone: 'zone_mq_marquee', desc: 'Out to the Marquee', requires: ['o2'] },
    ],
  },
  {
    id: 'quest_fs_haul', name: 'The Long Haul', credits: 25,
    description: "The long one nobody else wants: parcel through the Threshold to Castoff Walk, on to the Marquee, and all the way to Cathode Row before you turn back. It pays because it's a hike. 25₵.",
    objectives: [
      { id: 'o0', type: 'visit', zone: 'zone_threshold', desc: 'Through the Threshold' },
      { id: 'o1', type: 'visit', zone: 'zone_velk_exterior', desc: 'On to Castoff Walk', requires: ['o0'] },
      { id: 'o2', type: 'visit', zone: 'zone_mq_marquee', desc: 'On to the Marquee', requires: ['o1'] },
      { id: 'o3', type: 'visit', zone: 'zone_mq_cathode', desc: 'All the way to Cathode Row', requires: ['o2'] },
    ],
  },
];

// --- Marta Kell's dialogue: the philosophical encounter -----------------------
// Each creed fires its nudges ONCE (gated on the fs_creed flag it also sets), so a
// player can't re-open the conversation to farm reputation. Nothing here is labelled
// good or bad — everyone is just trying to survive.
const creedGate = [{ flag: 'fs_creed', scope: 'player', op: 'unset' }];
const MARTA_DIALOGUE = {
  root: {
    text: "The window's plexi is scratched to fog. Marta Kell slides a clipboard half an inch toward you without looking up. \"Board's on the wall. Take a tab, do the thing, bring it back, get paid. That's the whole religion.\" She finally lifts her eyes. \"You're new-made — I can always tell, they come out of that facility with the shine still on. So. What are you going to be?\"",
    // Talking to her counts as having "run into her" — clears the greeter gate.
    actions: [{ action: 'SET_FLAG', scope: 'player', flag: 'fs_marta_met', value: 'true' }],
    options: [
      {
        text: "\"Someone who eats. That's all.\"",
        conditions: creedGate,
        actions: [
          { action: 'ADJUST_REPUTATION', faction_id: 'faction_franchise', delta: 8, reason: 'creed:survival' },
          { action: 'ADJUST_ARCHITECT', delta: -5 },
          { action: 'SET_FLAG', scope: 'player', flag: 'fs_creed', value: 'survival' },
        ],
        next: 'eat',
      },
      {
        text: "\"Someone who remembers what all this was before.\"",
        conditions: creedGate,
        actions: [
          { action: 'ADJUST_REPUTATION', faction_id: 'faction_archivists', delta: 8, reason: 'creed:memory' },
          { action: 'ADJUST_ARCHITECT', delta: -3 },
          { action: 'SET_FLAG', scope: 'player', flag: 'fs_creed', value: 'memory' },
        ],
        next: 'remember',
      },
      {
        text: "\"Whatever the Architect needs me to be.\"",
        conditions: creedGate,
        actions: [
          { action: 'ADJUST_REPUTATION', faction_id: 'faction_custodians', delta: 8, reason: 'creed:devotion' },
          { action: 'ADJUST_ARCHITECT', delta: 12 },
          { action: 'SET_FLAG', scope: 'player', flag: 'fs_creed', value: 'devotion' },
        ],
        next: 'architect',
      },
      {
        text: "\"The one who pulls the plug on all of it, eventually.\"",
        conditions: creedGate,
        actions: [
          { action: 'ADJUST_REPUTATION', faction_id: 'faction_breakers', delta: 8, reason: 'creed:ruin' },
          { action: 'ADJUST_ARCHITECT', delta: -12 },
          { action: 'SET_FLAG', scope: 'player', flag: 'fs_creed', value: 'ruin' },
        ],
        next: 'breaker',
      },
      { text: "\"What's on the board?\"", next: 'work' },
    ],
  },
  eat: {
    text: "\"Honest.\" It isn't a compliment or an insult, just a reading. \"The ones who admit that outlast the ones with a cause. Causes get people killed for free. The board at least pays.\"",
    options: [{ text: "\"So what's on it?\"", next: 'work' }],
  },
  remember: {
    text: "She exhales smoke through the mesh. \"An Archivist thing to say. They buy old stories down in the tunnels, if you ever get that curious or that hungry. Me, I try to forget on schedule.\"",
    options: [{ text: "\"So what's on it?\"", next: 'work' }],
  },
  architect: {
    text: "Something in her face closes like a shop shutter. \"Custodian talk. There's a chapel two streets over that'd weep to hear it.\" A beat. \"The Architect doesn't need anything, kid. That's what makes it a god. It routes. You're a packet. So am I.\"",
    options: [{ text: "\"...So what's on the board?\"", next: 'work' }],
  },
  breaker: {
    text: "She almost smiles. \"The Breakers say that too — right up until winter, when they come slinking back for the heaters they smashed.\" A shrug. \"Serve it or smash it, the board doesn't care. Neither do I. Pay's the same either way.\"",
    options: [{ text: "\"So what's on it?\"", next: 'work' }],
  },
  work: {
    // OPEN_JOBBOARD appends the live rotating postings (with clickable Take/Hand-in)
    // to her reply — a static tree can't list the rotating set itself.
    actions: [{ action: 'OPEN_JOBBOARD' }],
    text: "\"Here's what's going. Take a tab off it, or type gigs — run the errand, bring it back to me at the window.\" She taps the clipboard, then goes back to watching a queue that isn't there.",
    options: [{ text: "(Turn to the board.)", actions: [{ action: 'END_CONVERSATION' }] }],
  },
};

// Stationary behaviour graph: Marta never leaves her window. Deliberately has NO
// movement node (no GO_TO_WORK / GO_HOME / HAVE_LIFE) so she can't drift to the
// Embassy — she waits, occasionally does a bit of at-the-desk flavour, and loops.
// Giving her an explicit graph also means ensureBehaviourGraph never auto-assigns
// her a walking default (vendor/unemployed), now or later. Dialogue is player-
// initiated and independent of this, so she still talks when approached.
const MARTA_BEHAVIOUR = {
  _start: 'start',
  nodes: {
    start: { type: 'start', next: 'wait' },
    wait: { type: 'wait', seconds: 90, next: 'pick' },
    pick: {
      type: 'random',
      branches: [{ weight: 3 }, { weight: 1 }, { weight: 1 }, { weight: 1 }],
      branch_0: 'loop', branch_1: 'e_ash', branch_2: 'e_clip', branch_3: 'e_cough',
    },
    e_ash: { type: 'action', action_type: 'EMOTE', params: { message: 'taps ash into a tin lid and watches a queue that isn\'t there.' }, next: 'loop' },
    e_clip: { type: 'action', action_type: 'EMOTE', params: { message: 'runs a finger down the clipboard, crossing nothing out.' }, next: 'loop' },
    e_cough: { type: 'action', action_type: 'EMOTE', params: { message: 'coughs, low and unbothered, and does not look up.' }, next: 'loop' },
    loop: { type: 'loop', next: 'start' },
  },
};

const MARTA = {
  id: 'npc_fs_dispatcher',
  name: 'Marta Kell',
  description: 'A grey woman behind a wire-mesh window, older than the war and twice as tired. A cigarette burns unattended in a tin lid beside a clipboard of jobs nobody wants. She has the face of someone who stopped hoping on a schedule and found it restful.',
  sex: 'female',
  zone_id: ZONE,
  dialogue_tree: MARTA_DIALOGUE,
  behaviour_graph: MARTA_BEHAVIOUR,
  flags: { clothing_layers: ['a shapeless municipal cardigan', 'fingerless gloves worn through at the tips'] },
};

const BOARD_FURNITURE = {
  id: 'furn_fs_jobboard',
  zone_id: ZONE,
  name: 'the job board',
  object_type: 'decoration',
  description: "A slab of corkboard and warped ply bolted to a drive-through pillar, layered years deep in torn card, ration stubs, and hand-lettered work. Somewhere under all of it is a day's pay. A man in a paper coat is reading it for the third time. Read the board (or type gigs) to see what's posted.",
  // job_board tag makes `read <board>` list the live postings + surfaces a Read
  // action on the board's smart bar (specializedActions in the jobboard plugin).
  flags: { job_board: true },
};

const BOARD = {
  id: 'board_franchise_strip',
  zone_id: ZONE,
  name: 'Franchise Strip — Day Work',
  description: "Take a tab, run the errand, bring it back to Marta at the window. It won't make you rich. It'll make you fed.",
  quest_pool: QUESTS.map((q) => q.id),
  rotation_size: 3,
  rotation_period: 21600,
};

const AMBIENCE = [
  'A man in a paper coat reads the job board top to bottom, then reads it again, as if a posting he can live on might appear if he wants it badly enough.',
  'Someone has scratched HELP into the plexi of the dispatch window. Someone else has scratched WHO underneath it.',
  "The ration line down the block hasn't moved in an hour. Nobody leaves it anyway.",
];

// The greeter gate (jobboard plugin move gate): the FIRST time a new player tries to
// leave the Strip without having met Marta, she stops them once and hollers one of
// these — pointing them at the board — then lets them go. Set as zone flags.greeter;
// keyed to met_flag fs_marta_met (also set when they talk to her). Her voice: dry,
// blunt, tired, kind under the ash.
const GREETER = {
  npc_id: MARTA.id,
  npc_name: MARTA.name,
  met_flag: 'fs_marta_met',
  lines: [
    "Hey — hey! Not so fast. You've got that fresh-decant shine and empty pockets, I can spot it blind. If you need money, that board's got work. Come back to me when it's done.",
    "Whoa there. Where you off to in such a hurry, broke as you are? There's a board right there. Take a job, bring it back to me. Then you can go.",
    "Hold up, shine. You look desperate, and that's alright — everybody does, first week. Work's on the board. See me after. That's the deal.",
    "Hey! You. Yeah, you. Don't go wandering out there hungry. Check the board, do a job, come back to my window. Simple as that.",
    "Slow down. Out there they don't hand out second chances. In here there's a board and there's me. Pick a tab, come back when it's done.",
    "Easy, new blood. You've got 'desperate' written all over you — no shame in it. Money's on that board if you want it. Just come see me when you've earned it.",
  ],
};

async function main() {
  // Quests
  for (const q of QUESTS) {
    await query(
      `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,updated_at)
       VALUES ($1,$2,$3,$4,$5,1,EXTRACT(EPOCH FROM NOW()))
       ON CONFLICT (id) DO UPDATE SET name=$2,description=$3,objectives=$4,rewards=$5,repeatable=1,
         updated_at=EXTRACT(EPOCH FROM NOW())`,
      [q.id, q.name, q.description, JSON.stringify(q.objectives), JSON.stringify({ credits: q.credits })]
    );
    console.log(`  quest  ${q.id.padEnd(18)} ${q.name} (${q.credits}₵)`);
  }

  // Board
  await query(
    `INSERT INTO job_boards (id,zone_id,name,description,quest_pool,rotation_size,rotation_period,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (id) DO UPDATE SET zone_id=$2,name=$3,description=$4,quest_pool=$5,
       rotation_size=$6,rotation_period=$7,updated_at=EXTRACT(EPOCH FROM NOW())`,
    [BOARD.id, BOARD.zone_id, BOARD.name, BOARD.description, JSON.stringify(BOARD.quest_pool),
     BOARD.rotation_size, BOARD.rotation_period]
  );
  // Reset any cached rotation so the fresh pool shows immediately.
  await query('DELETE FROM world_flags WHERE flag_key=$1', [`jobboard_rot_${BOARD.id}`]);
  console.log(`  board  ${BOARD.id} (pool ${BOARD.quest_pool.length}, shows ${BOARD.rotation_size})`);

  // Furniture (the board itself)
  await query(
    `INSERT INTO furniture (id,zone_id,name,description,object_type,flags)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET zone_id=$2,name=$3,description=$4,object_type=$5,flags=$6`,
    [BOARD_FURNITURE.id, BOARD_FURNITURE.zone_id, BOARD_FURNITURE.name, BOARD_FURNITURE.description,
     BOARD_FURNITURE.object_type, JSON.stringify(BOARD_FURNITURE.flags)]
  );
  console.log(`  furn   ${BOARD_FURNITURE.id}`);

  // Marta — home_zone pinned to the strip, NO work_zone_id (a work_zone_id makes an
  // NPC autonomous → default vendor commute → she'd walk "home" to the Embassy off-
  // shift). Explicit stationary graph keeps her at the window. work_zone_id=NULL in
  // the UPDATE repairs any earlier run that set it.
  await query(
    `INSERT INTO npcs (id,name,description,zone_id,home_zone,dialogue_tree,behaviour_graph,flags,sex)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET name=$2,description=$3,zone_id=$4,home_zone=$4,dialogue_tree=$5,
       behaviour_graph=$6,flags=$7,sex=$8,work_zone_id=NULL`,
    [MARTA.id, MARTA.name, MARTA.description, MARTA.zone_id, JSON.stringify(MARTA.dialogue_tree),
     JSON.stringify(MARTA.behaviour_graph), JSON.stringify(MARTA.flags), MARTA.sex]
  );
  console.log(`  npc    ${MARTA.id} (${MARTA.name})`);

  // Ambience + greeter: merge into the zone's ambient_events / flags (no clobber).
  const { rows } = await query('SELECT ambient_events, flags FROM zones WHERE id=$1', [ZONE]);
  if (rows.length) {
    const existing = Array.isArray(rows[0].ambient_events) ? rows[0].ambient_events : [];
    const merged = existing.slice();
    for (const line of AMBIENCE) if (!merged.includes(line)) merged.push(line);
    const flags = (rows[0].flags && typeof rows[0].flags === 'object') ? rows[0].flags : {};
    flags.greeter = GREETER;
    await query('UPDATE zones SET ambient_events=$1, flags=$2 WHERE id=$3',
      [JSON.stringify(merged), JSON.stringify(flags), ZONE]);
    console.log(`  zone   ${ZONE} ambience → ${merged.length} lines, greeter → ${GREETER.npc_name}`);
  } else {
    console.warn(`  WARN: zone ${ZONE} not found — ambience/greeter not applied.`);
  }

  console.log('\nDone. Reload the world (/world/reload) or restart so the NPC, furniture, and board go live.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
