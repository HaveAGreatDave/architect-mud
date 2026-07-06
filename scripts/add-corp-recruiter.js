/**
 * Content: Denny Corliss, the Franchise corp recruiter on the Strip.
 *
 * The corp recruitment posters (scripts/seed-corp-posters.mjs) glow up the *idea*
 * of owning an outfit but deliberately no longer print the command list — the
 * corps `furniture.describe` hook now just points a fresh clone toward "a smiling
 * man on the Strip." This is that man. Every mechanic a beginner needs — founding,
 * recruiting, holding ground, the treasury, the ops console — is taught here, in
 * his mouth, in character, earned through the conversation instead of stamped on a
 * wall. He's the natural, human on-ramp the posters advertise.
 *
 * He shares the Franchise Strip (zone_city_west) with Marta Kell's grey job-board
 * window — the two are deliberate opposites: she sells you a day's bread, he sells
 * you the dream of never needing the window again. Stationary behaviour graph so he
 * never leaves his folding table (same pattern as Marta).
 *
 * Idempotent: ON CONFLICT DO UPDATE, so re-running re-applies edits. One-shot
 * content seed, NOT a boot migration.
 *
 *   Local:  node scripts/add-corp-recruiter.js
 *   Prod:   node --env-file=.env.prod scripts/add-corp-recruiter.js
 *
 * Then reload the world (dev panel → /world/reload) or restart so Denny goes live.
 */
import { query } from '../server/models/db.js';

const ZONE = 'zone_city_west';
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
    text: "\"A shared pot — that's what makes it a *corp* and not just friends,\" he says. \"<b>corp contribute &lt;amount&gt;</b> feeds the treasury; <b>corp disburse</b> pays it back out when your people earn it. Territory pays rent into it, upkeep bleeds out of it, and the whole thing runs off a console.\" He jerks a thumb vaguely northward. \"Every headquarters gets its own ops terminal — <b>use</b> it when you've got one. Or, right now, anywhere: just type <b>corp</b> and it opens for you. Go on. Poke it. It won't bite till you've got something to lose.\"",
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

// Stationary behaviour graph (same shape as Marta Kell's): NO movement node, so
// ensureBehaviourGraph never auto-assigns him a walking default and he can't drift
// off the Strip. He waits, does a bit of salesman flavour, and loops.
const BEHAVIOUR = {
  _start: 'start',
  nodes: {
    start: { type: 'start', next: 'wait' },
    wait: { type: 'wait', seconds: 75, next: 'pick' },
    pick: {
      type: 'random',
      branches: [{ weight: 3 }, { weight: 1 }, { weight: 1 }, { weight: 1 }],
      branch_0: 'loop', branch_1: 'e_fan', branch_2: 'e_pitch', branch_3: 'e_badge',
    },
    e_fan: { type: 'action', action_type: 'EMOTE', params: { message: 'fans a brochure at a passerby who does not slow down, and keeps smiling anyway.' }, next: 'loop' },
    e_pitch: { type: 'action', action_type: 'EMOTE', params: { message: 'calls out, "Own a piece! No charge for talk!" to the middle distance.' }, next: 'loop' },
    e_badge: { type: 'action', action_type: 'EMOTE', params: { message: 'polishes his laminated name badge on a green sleeve until it squeaks.' }, next: 'loop' },
    loop: { type: 'loop', next: 'start' },
  },
};

const DENNY = {
  id: 'npc_corp_recruiter',
  name: 'Denny Corliss',
  description: "A bright, tireless man working a folding card table like it's a stage. His Franchise-green blazer is a half-size too eager and pressed within an inch of its life; a laminated badge reads DENNY CORLISS · ONBOARDING. The brochures fanned in front of him have clearly never left the table, but his smile keeps selling anyway — the practised warmth of someone who's decided, on purpose, to be the only good news on the street.",
  sex: 'male',
  zone_id: ZONE,
  dialogue_tree: DIALOGUE,
  behaviour_graph: BEHAVIOUR,
  flags: { clothing_layers: ['a too-green Franchise blazer, pressed sharp', 'a laminated ONBOARDING name badge', 'scuffed dress shoes hidden behind the table'] },
};

async function main() {
  const { rows } = await query('SELECT id FROM zones WHERE id=$1', [ZONE]);
  if (!rows.length) { console.error(`✗ zone ${ZONE} not found — is the world seeded?`); process.exit(1); }

  // work_zone_id=NULL keeps an earlier run from making him autonomous (which would
  // send him commuting off the Strip). home_zone pinned to the Strip; stationary graph.
  await query(
    `INSERT INTO npcs (id,name,description,zone_id,home_zone,dialogue_tree,behaviour_graph,flags,sex)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET name=$2,description=$3,zone_id=$4,home_zone=$4,dialogue_tree=$5,
       behaviour_graph=$6,flags=$7,sex=$8,work_zone_id=NULL`,
    [DENNY.id, DENNY.name, DENNY.description, DENNY.zone_id, JSON.stringify(DENNY.dialogue_tree),
     JSON.stringify(DENNY.behaviour_graph), JSON.stringify(DENNY.flags), DENNY.sex]
  );
  console.log(`✓ npc ${DENNY.id} (${DENNY.name}) → ${ZONE}`);
  console.log('\nDone. Reload the world (/world/reload) or restart so Denny goes live.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
