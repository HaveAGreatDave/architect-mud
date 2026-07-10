/**
 * Content: Denny Corliss, the Franchise corp recruiter — now working the gates of
 * the Yards.
 *
 * The corp recruitment posters (scripts/seed-corp-posters.mjs) glow up the *idea*
 * of owning an outfit but deliberately no longer print the command list — the
 * corps `furniture.describe` hook now just points a fresh clone toward "a smiling
 * man down at the Yards." This is that man. Every mechanic a beginner needs —
 * founding, recruiting, holding ground, the treasury, and (now) reaching the whole
 * corp interface straight from the tablet Corporation app — is taught here, in his
 * mouth, in character, earned through the conversation instead of stamped on a wall.
 *
 * Placement: he sets up his folding table at The Depot (zone_yard_depot), the
 * westernmost yard zone — the entrance to the Yards from the Marquee District. He
 * still keeps his own apartment (zone_meridian_unit_601) and commutes: a round-the-
 * clock schedule + the standard vendor commute graph keep him at the table whenever
 * a player is likely to be around, while home_zone gives him a real place to belong.
 *
 * Idempotent: ON CONFLICT DO UPDATE, so re-running re-applies edits. One-shot
 * content seed, NOT a boot migration. The authoritative copy of this NPC lives at
 * content/npcs/npc_corp_recruiter.json (the CODEX deploy path); keep the two in sync.
 *
 *   Local:  node scripts/add-corp-recruiter.js
 *   Prod:   node --env-file=.env.prod scripts/add-corp-recruiter.js
 *
 * Then reload the world (dev panel → /world/reload) or restart so Denny goes live.
 */
import { query } from '../server/models/db.js';

const WORK_ZONE = 'zone_yard_depot';          // his folding table — the Yards' gate
const HOME_ZONE = 'zone_meridian_unit_601';   // his apartment; he commutes from here
const FOUND_FEE = 1000; // keep in sync with FOUND_FEE in plugins/corps/index.js

// Denny teaches the ropes. Each topic node loops back to `menu` so a player can
// learn every pillar in one sitting, then leave. Nothing here is gated or rewarded
// — it's a tutorial dressed as a sales pitch, not a creed choice like Marta's.
const DIALOGUE = {
  root: {
    text: "A folding card table, a stack of laminated brochures nobody's touched, and behind them a man who lights up like a switch the second you slow down. Franchise-green blazer a half-size too eager, a smile focus-grouped to within an inch of its life. \"There she is — fresh off the line, still got the shine on you! Don't walk past, don't walk past. Denny Corliss, Franchise onboarding, and I have got the only good news in this whole grey town.\" He fans a brochure he doesn't hand over. \"You woke up owning nothing. I'm here to fix step one of that. Ask me anything — no charge for talk.\"",
    options: [
      { text: "\"Fine. How does a person actually start one of these?\"", next: 'found' },
      { text: "\"Say I had people. How do they get in?\"", next: 'people' },
      { text: "\"The posters go on about 'holding ground.' What's that mean?\"", next: 'ground' },
      { text: "\"And the money? Where does it live?\"", next: 'treasury' },
      { text: "\"What's the catch, Denny?\"", next: 'catch' },
      { text: "\"Not today.\"", actions: [{ action: 'END_CONVERSATION' }] },
    ],
  },
  found: {
    text: `He plants both palms on the table like he's been waiting all week. "Simplest thing in the world, and the hardest — you just *decide*. Type <b>corp found &lt;name&gt;</b> and pick something they'll spray on a wall someday. It runs you ${FOUND_FEE}₵ — the license, the paperwork, the *realness* of it — and the second it clears, that's it: you're the Founder. Not a packet. Not a number. A name at the top of an org chart." He taps his own badge. "First one's the whole battle, kid."`,
    options: [
      { text: "\"Alright — what else do I need to know?\"", next: 'menu' },
      { text: "\"That's enough for now.\"", actions: [{ action: 'END_CONVERSATION' }] },
    ],
  },
  people: {
    text: "\"An outfit of one is a hobby,\" he says, like it's the saddest thing he's ever heard. \"You want bodies. <b>corp invite &lt;name&gt;</b> puts the word out to somebody standing near you — they say yes, they're yours. Want to see who's already flying your colours? <b>corp roster</b>, any time. Watch it grow. There's no feeling like it.\" He almost means it.",
    options: [
      { text: "\"Alright — what else?\"", next: 'menu' },
      { text: "\"That's enough for now.\"", actions: [{ action: 'END_CONVERSATION' }] },
    ],
  },
  ground: {
    text: "His voice drops, conspiratorial, delighted. \"*That's* the good part. A name's just a name until it's stamped on dirt. Stand in a district that matters and type <b>corp claim</b> — now it's tugging your way. Some rival's already sitting on the block you want? <b>corp contest</b> theirs and pull it loose, inch by inch. And when you want to see the whole board — who holds what, where the lines are moving — <b>corp map</b> lays the city out in your colours and everyone else's.\" He spreads his hands like he's showing you a kingdom.",
    options: [
      { text: "\"Alright — what else?\"", next: 'menu' },
      { text: "\"That's enough for now.\"", actions: [{ action: 'END_CONVERSATION' }] },
    ],
  },
  treasury: {
    text: "\"A shared pot — that's what makes it a *corp* and not just friends,\" he says. \"<b>corp contribute &lt;amount&gt;</b> feeds the treasury; <b>corp disburse</b> pays it back out when your people earn it. Territory pays rent into it, upkeep bleeds out of it, and the whole thing runs off a console.\" He nods at the slab in your pocket like he put it there himself. \"And here's the part they bury — you're *carrying* the console. Pull up your <b>tablet</b>, tap the <b>Corporation</b> app, and the treasury, the roster, the whole map open right there in your hand, anywhere in the basin. No headquarters, no terminal, no waiting. Or just type <b>corp</b> — same door. Go on. Poke it. It won't bite till you've got something to lose.\"",
    options: [
      { text: "\"Alright — what else?\"", next: 'menu' },
      { text: "\"That's enough for now.\"", actions: [{ action: 'END_CONVERSATION' }] },
    ],
  },
  catch: {
    text: "For just a beat the smile hangs on nothing, like a coat on a hook. \"Catch. Sure. Everybody wants the catch.\" He straightens a brochure that was already straight. \"There's no catch you can *see*, and that's the honest answer. The license is real. The city's really up for grabs. It's just...\" He glances up, briefly, at nothing — at everything. \"They only let the good ground go where the work gets *noticed*. Push hard enough, get big enough, and you'll feel something up north start paying attention. Most folks never get far enough to find out what.\" The switch flips back on. \"But you're not most folks, are you. So — where do we start?\"",
    options: [
      { text: "\"Start me at the top. How do I found one?\"", next: 'found' },
      { text: "\"Show me the rest.\"", next: 'menu' },
      { text: "\"I've heard enough.\"", actions: [{ action: 'END_CONVERSATION' }] },
    ],
  },
  menu: {
    text: "\"Course. Pick your poison.\" He fans the brochures again, all business, all delight.",
    options: [
      { text: "\"Founding one.\"", next: 'found' },
      { text: "\"Bringing people in.\"", next: 'people' },
      { text: "\"Holding ground.\"", next: 'ground' },
      { text: "\"The money.\"", next: 'treasury' },
      { text: "\"The catch.\"", next: 'catch' },
      { text: "\"Nothing else. Thanks, Denny.\"", actions: [{ action: 'END_CONVERSATION' }] },
    ],
  },
};

// Round-the-clock schedule: with every day open 0–24, isVendorWorkTime always
// reports "working", so the commute graph parks him at the Depot table whenever a
// player might wander in. home_zone is still his — the graph would send him there
// off-shift, he just never is.
const SCHEDULE = {
  mon: [{ from: 0, to: 24 }], tue: [{ from: 0, to: 24 }], wed: [{ from: 0, to: 24 }],
  thu: [{ from: 0, to: 24 }], fri: [{ from: 0, to: 24 }], sat: [{ from: 0, to: 24 }],
  sun: [{ from: 0, to: 24 }],
};

// His salesman flavour, delivered by VENDOR_CHITCHAT (work_say) when a player is in
// zone. A line wrapped end-to-end in quotes reads as a says-bubble; the rest emote.
const CHITCHAT = [
  'fans a brochure at a passerby who does not slow down, and keeps smiling anyway.',
  '"Own a piece! No charge for talk!"',
  'polishes his laminated name badge on a green sleeve until it squeaks.',
];

// Standard vendor commute graph (buildDefaultVendorGraph, alphabetised): CHECK_VENDOR_WORK
// routes him from the apartment to the Depot on shift, holds him at the table (work_say),
// and would walk him home off-shift. The safe/ATM/deposit steps no-op harmlessly for a
// non-selling recruiter with no linked safe.
const BEHAVIOUR = {
  _start: 'start',
  nodes: {
    start:          { type: 'start', next: 'check_work' },
    check_work:     { type: 'action', action_type: 'CHECK_VENDOR_WORK',
                      goToWork: 'go_to_work', haveLife: 'have_life',
                      endShift: 'collect_safe', offWork: 'off_home_check' },
    go_to_work:     { type: 'action', action_type: 'GO_TO_WORK', next: 'work_wait' },
    work_wait:      { type: 'wait', seconds: 60, next: 'player_check' },
    player_check:   { type: 'condition', condition_type: 'PLAYER_IN_ZONE',
                      ifTrue: 'work_say', ifFalse: 'check_work' },
    work_say:       { type: 'action', action_type: 'VENDOR_CHITCHAT', next: 'check_work' },
    have_life:      { type: 'action', action_type: 'HAVE_LIFE', next: 'check_work' },
    collect_safe:   { type: 'action', action_type: 'VENDOR_COLLECT_SAFE', next: 'go_to_atm' },
    go_to_atm:      { type: 'action', action_type: 'VENDOR_GO_TO_ATM', next: 'atm_emote' },
    atm_emote:      { type: 'action', action_type: 'EMOTE',
                      params: { message: 'steps up to the ATM terminal and makes a deposit.' },
                      next: 'atm_wait' },
    atm_wait:       { type: 'wait', seconds: 10, next: 'deposit' },
    deposit:        { type: 'action', action_type: 'VENDOR_DEPOSIT', next: 'post_shift' },
    post_shift:     { type: 'random', branches: [{ weight: 1 }, { weight: 5 }],
                      branch_0: 'have_life', branch_1: 'go_home_ps' },
    go_home_ps:     { type: 'action', action_type: 'GO_HOME', next: 'home_life_ps' },
    home_life_ps:   { type: 'action', action_type: 'AT_HOME_LIFE', next: 'check_work' },
    off_home_check: { type: 'condition', condition_type: 'AT_HOME',
                      ifTrue: 'home_idle', ifFalse: 'off_random' },
    home_idle:      { type: 'action', action_type: 'AT_HOME_LIFE', next: 'check_work' },
    off_random:     { type: 'random', branches: [{ weight: 1 }, { weight: 5 }],
                      branch_0: 'have_life', branch_1: 'go_home_off' },
    go_home_off:    { type: 'action', action_type: 'GO_HOME', next: 'check_work' },
  },
};

const DENNY = {
  id: 'npc_corp_recruiter',
  name: 'Denny Corliss',
  description: "A bright, tireless man working a folding card table like it's a stage. His Franchise-green blazer is a half-size too eager and pressed within an inch of its life; a laminated badge reads DENNY CORLISS · ONBOARDING. The brochures fanned in front of him have clearly never left the table, but his smile keeps selling anyway — the practised warmth of someone who's decided, on purpose, to be the only good news on the street.",
  sex: 'male',
  work_zone: WORK_ZONE,
  home_zone: HOME_ZONE,
  dialogue_tree: DIALOGUE,
  behaviour_graph: BEHAVIOUR,
  chitchat: CHITCHAT,
  vendor_schedule: SCHEDULE,
  flags: { clothing_layers: ['a too-green Franchise blazer, pressed sharp', 'a laminated ONBOARDING name badge', 'scuffed dress shoes hidden behind the table'] },
};

async function main() {
  const { rows } = await query('SELECT id FROM zones WHERE id=$1', [WORK_ZONE]);
  if (!rows.length) { console.error(`✗ zone ${WORK_ZONE} not found — is the world seeded?`); process.exit(1); }

  // home_zone = apartment, work_zone_id = Depot: he commutes on his round-the-clock
  // schedule via the vendor graph, parking at the table whenever players are about.
  await query(
    `INSERT INTO npcs (id,name,description,zone_id,home_zone,work_zone_id,dialogue_tree,behaviour_graph,chitchat,vendor_schedule,flags,sex)
     VALUES ($1,$2,$3,$4,$5,$4,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET name=$2,description=$3,zone_id=$4,home_zone=$5,work_zone_id=$4,
       dialogue_tree=$6,behaviour_graph=$7,chitchat=$8,vendor_schedule=$9,flags=$10,sex=$11`,
    [DENNY.id, DENNY.name, DENNY.description, DENNY.work_zone, DENNY.home_zone,
     JSON.stringify(DENNY.dialogue_tree), JSON.stringify(DENNY.behaviour_graph),
     JSON.stringify(DENNY.chitchat), JSON.stringify(DENNY.vendor_schedule),
     JSON.stringify(DENNY.flags), DENNY.sex]
  );
  console.log(`✓ npc ${DENNY.id} (${DENNY.name}) → work ${WORK_ZONE}, home ${HOME_ZONE}`);
  console.log('\nDone. Reload the world (/world/reload) or restart so Denny goes live.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
