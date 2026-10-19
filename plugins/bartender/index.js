// bartender — brings bartender-personality NPCs to life behind the bar.
//
// The archetype already hands Lowry a pool of *canned* work chitchat; the engine
// fires it sparsely from the AT_WORK behaviour node. This plugin is the reactive
// layer on top: a ~30s tick that reads the LIVE room the bartender is standing in
// and reacts in character instead of at random —
//
//   • a first-week player walks in  → he clocks them, welcomes them by handle,
//     and drips real survival tips one at a time over the night
//   • a poker hand is running        → rail commentary that reads the actual pot
//   • the TV is on                   → a remark on the kind of show that's airing
//   • Orion Dex is on the floor      → a rare, curated coworker back-and-forth
//     between the two of them (the bartender and the Embassy's house card dealer)
//   • otherwise                      → bar business: pouring, wiping, the patter
//
// It also registers three dialogue actions (BARTENDER_ADVICE / _TV / _POKER) so the
// same live reads answer when a player `talk`s to him and picks the matching option.
//
// Why the coworker banter lives HERE and not in the shared npc-banter engine: that
// engine excludes any NPC that's on-shift (isEligible → !vendor_was_working), and
// Lowry works the Embassy 24/7 — so it would never pair him with anyone. This tick
// is the one place that fires *while* he's behind the bar, which is exactly when the
// two of them are both on the floor. The pairing is hard-wired to Orion Dex.
//
// Scope: any NPC with flags.personality === 'bartender' who is on-shift at their
// bar with at least one player watching. All state is in-memory (resets on
// restart) — a bartender's memory of who's new doesn't warrant a persisted Flag.
//
// Voices: the *reactive logic* is shared, the *words* are not. VOICES keys a
// per-bartender line set (welcomes, idle patter, coworker two-hander) off the NPC
// id, falling back to Lowry's. Without this every bartender in the world greets
// players to "the Embassy" in Lowry's name — so a new bar needs a VOICES entry,
// not a second copy of this plugin.

import { schedule } from '../../server/engine/scheduler.js';
import { world, getZonePlayers } from '../../server/engine/world.js';
import { isNpcAtWork, formatChitchat } from '../../server/engine/ai-behaviour.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { activeTables } from '../gametable/game-table.js';
import { getZoneNowPlaying } from '../broadcast/index.js';
import { pick, randInt } from '../../server/engine/util.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
const NEW_PLAYER_MS     = 7 * 24 * 60 * 60 * 1000; // "first week or so"
const WELCOME_REPEAT_MS = 12 * 60 * 60 * 1000;     // re-greet a returning newcomer after this
const AMBIENT_GAP_MS    = 45_000;                  // min gap between ambient lines (not welcomes)
const WELCOME_MIN_GAP_MS = 8_000;                  // tiny anti-double-talk gap before a welcome
const SPEAK_CHANCE      = 0.65;                     // an eligible tick where he just works quietly

const COWORKER_GAP_MS   = 5 * 60 * 1000;           // keep the two-hander a rare treat, not a loop
const COWORKER_CHANCE   = 0.4;                      // ...and only sometimes when it's eligible
const COWORKER_TURN_MS  = [4500, 8000];            // random delay between turns of the exchange

const TV_MEMORY         = 6;                        // TV remarks a bartender won't repeat until others have aired
const TV_OWN_POOL       = 0.75;                     // chance a remark is about this kind of show, not the set itself

// ── In-memory memory ──────────────────────────────────────────────────────────
const lastSpoke   = new Map(); // npcId    -> ms of his last line (any kind)
const welcomedAt  = new Map(); // playerId -> ms he last welcomed them
const tipsGiven   = new Map(); // playerId -> Set(tip index)
const coworkerAt  = new Map(); // npcId    -> ms the last coworker scene began
const sceneZones  = new Set(); // zoneIds with a coworker scene currently running
const tvSaid      = new Map(); // npcId    -> his last TV_MEMORY remarks about the set, oldest first

// ── Content ───────────────────────────────────────────────────────────────────
// Fully-quoted lines render as a yellow "Lowry says:" bubble; unquoted lines
// render as an emote ("Lowry wipes down the counter."). {name} → the guest's handle.

const LOWRY_WELCOMES = [
  `"Well. Fresh meat in a clean jacket. Welcome to the Embassy, {name}: Lowry's the name. You've got the look of someone who booted up about ten minutes ago."`,
  `"New face, and a green one. First week, unless I've lost my eye, and I haven't. Sit down, {name}. Let me point you at a few things before the basin does it the hard way."`,
  `"Valued guest, freshly minted. Welcome to the Embassy Lounge, {name}. Stick near the bar a while: I've kept more newcomers breathing than any clinic in this city."`,
];

// Ordered roughly by how soon a newcomer needs it. Every verb here is real.
const TIPS = [
  `"Word of advice, {name}: hunger and thirst kill more newcomers than bullets do. Keep something in your gut. The cheap stuff's a few credits and it counts as both."`,
  `"You die out here and whatever's in your pockets is anyone's, {name}. Whatever's in the bank is still yours. There's an ATM on the wall: 'deposit' before you go looking for trouble, not after."`,
  `"Cameras on every corner, and the law here doesn't do warnings, {name}. Build up enough heat and you'll wake in Precinct 9 with your gear in an evidence locker. Type 'wanted' if you want to know how deep you're in."`,
  `"Broke, {name}? Everyone starts broke. 'scavenge' the trash and the wastes for salvage, or check the job board, 'gigs', for honest-ish work. Nobody out here got fed standing still."`,
  `"Bleeding's not a personality, {name}. Sit down, 'rest', let the body knit before you go swinging at things again. Dead men tip poorly."`,
  `"Check the 'map' before you wander, {name}. Some corners of this basin (the Redline, the deep wastes) will cook you or eat you before you've read the room. Green's for grass, not for you."`,
  `"Don't pick fights bare, {name}. 'look' at a thing before you 'attack' it, and 'equip' something between your skin and their edge. Armor's the difference between a scar and a corpse."`,
  `"Nobody here was born good at anything, {name}. You get better by doing: 'skills' and 'stats' show where you stand. The basin rewards the useful and buries the rest."`,
  `"Everything you do out here, somebody keeps score, {name}. Help the wrong crew, cross the right one: check 'rep' now and then. Grudges in this city have long memories and short fuses."`,
  `"You'll hear there's money in cooking and dealing, {name}. There is. There's also addiction, overdoses, and a manufacturing charge that puts the whole precinct on your back. Easy money out here bites."`,
  `"Pay first, trust later: that's policy, {name}, and it's good policy for you too. Somebody buys you a drink and calls you friend inside a minute? They're pricing your pockets."`,
  `"This bar's not the world, {name}, whatever it feels like at three in the morning. There's aircraft to fly, crews to run, a whole city under the city. Survive the first week and it all opens up."`,
];

const LOWRY_GRADUATION = [
  `"That's about all the free wisdom I've got, {name}. The rest you'll earn the way we all did: badly, and in public."`,
  `"You're asking sharper questions now, {name}. You'll do. Or you won't. Either way you're not my greenest guest anymore."`,
];

// Non-newcomer / veteran deflections for the dialogue "advice?" option.
const LOWRY_VETERAN_ADVICE = [
  `"Advice? You've got the calluses, {name}. You know how it works: keep breathing and keep paying."`,
  `"You don't need me holding your hand anymore. Drink up. That's the only tip that never expires."`,
  `"Same advice as ever: trust the room less than it wants you to. You've been here long enough to know I'm right."`,
];

// A guest walks in wearing heat. Lowry runs a respectable house and does NOT want
// it — the Reach voice below inverts this, which is the whole point of the place.
const LOWRY_HEAT = [
  `"{name}. You're lit up like a signal fire and you brought it through my door. Drink fast."`,
  `wipes the same spot twice, eyes on the door behind you. "Whatever's chasing you: settle up before it arrives."`,
  `"I don't ask what you did. I do ask that you do the next one somewhere else."`,
];

const LOWRY_IDLE = [
  `wipes down the counter with a rag that's seen worse than you.`,
  `polishes a glass that was already clean.`,
  `lines up a fresh row of glasses nobody's asked for.`,
  `"What'll it be? The Reserve, if you're flush. The Swill, if you're honest."`,
  `"Canapés are complimentary with a drink. They're not, in any real sense, complimentary."`,
  `"Tab's running whether you drink or not. Might as well drink."`,
  `draws a slow pour of the Swill and slides it down the bar to no one in particular.`,
  `"Slow night. They're all slow nights. That's the business."`,
];

// ── Coworker banter (Lowry ⇄ Orion Dex) ─────────────────────────────────────────
// A curated back-and-forth between the bartender and the Embassy's house card
// dealer — two old hands running the same little vice-lounge, Lowry pouring the
// reasons to stay, Orion dealing the felt. Each thread is an ordered list of
// [who, line] turns; who is 'L' (Lowry) or 'O' (Orion). Same render convention as
// chitchat: a fully-"quoted" turn is a say bubble, an unquoted turn is an emote.
// These are unique to this pair — nobody else gets them.
const LOWRY_COWORKER = [
  [
    ['L', `"Slow night at the felt, Dex. You've dealt the same four regulars into the ground since sundown."`],
    ['O', `"They keep sitting down. I keep dealing. The chairs do half my work."`],
    ['L', `"The house takes its cut in blood, I take mine in drinks. Somewhere in the middle there's a living."`],
  ],
  [
    ['O', `squares the deck without looking up. "You're telling that story too loud again, Lowry."`],
    ['L', `"I tell it at the volume it's earned. You've worn the same face since this place had a roof worth the name."`],
    ['O', `"It's the only thing in here that's never lost me money."`],
  ],
  [
    ['L', `"Fresh one at the bar tonight, Dex. Green as they come."`],
    ['O', `"Send them over when they've found their legs. Not before. I don't take milk money: bad for repeat business."`],
  ],
  [
    ['L', `"How long's it been, you and me working this room?"`],
    ['O', `riffles the deck, bridges it, snaps it flat. "Long enough that neither of us tells the truth about it anymore."`],
    ['L', `"Valued colleague. Sincerity optional."`],
  ],
  [
    ['L', `"Pour you something? On the house. The house being me."`],
    ['O', `"Never on shift. A dealer with a drink in him is a dealer counting wrong."`],
    ['L', `"That's the most honest thing said in this building all week."`],
  ],
  [
    ['O', `"Two by the door have been nursing the same drink an hour. Watching the till, not the cards."`],
    ['L', `polishes a glass, eyes flicking to the door. "Noted. You deal: I'll keep the bad thoughts warm."`],
  ],
  [
    ['L', `"You deal them the cards, I pour them the reason to keep sitting there."`],
    ['O', `"Two halves of the same robbery. Difference is I make them sign for it."`],
  ],
  [
    ['O', `taps the felt twice, an old habit. "Quiet tonight."`],
    ['L', `"They're all quiet, Dex. That's the business."`],
    ['O', `"That's your line."`],
    ['L', `"Everything in here's on loan. The lines included."`],
  ],
];

// ── Marla Kest ⇄ Ambrose "Doc" Teller (The Coyote's Rest, the Reach) ───────────
// The frontier mirror of Lowry & Orion: a bartender and a card dealer keeping the
// only lit room for a hundred miles. Where the Embassy pair trade in polish, these
// two trade in what nobody says out loud.
const MARLA_COWORKER = [
  [
    ['L', `"Quiet strip tonight, Doc. Nothing's come in since the light went."`],
    ['O', `squares the deck without looking up. "Something'll come in. Always does. That's what the strip is for."`],
    ['L', `"That's what I'm afraid of."`],
  ],
  [
    ['O', `"You water that bottle, Marla, or is it just old?"`],
    ['L', `"It's old. Everything out here's old. Including the joke."`],
  ],
  [
    ['L', `"New face at the bar, Doc. Flew in on their own wings."`],
    ['O', `"Then they've got money or they've got trouble. Sit them down either way: the felt sorts it out faster than you will."`],
  ],
  [
    ['O', `"Nobody's asked me for a marker in a month. Reach is getting honest."`],
    ['L', `pours without being asked. "Reach is getting broke. Different thing."`],
    ['O', `"From where I sit they pay the same."`],
  ],
  [
    ['L', `"You ever think about flying out, Doc?"`],
    ['O', `fans the deck one-handed, then folds it flat. "I thought about it once. Then I dealt myself a hand and stayed."`],
    ['L', `"That's not an answer."`],
    ['O', `"It's the one I've got."`],
  ],
  [
    ['O', `"Dust is coming. My knuckles say so."`],
    ['L', `"Your knuckles said so last week and we got nothing but heat."`],
    ['O', `"Then my knuckles are patient."`],
  ],
  [
    ['L', `"They come in here running from something. Every one of them."`],
    ['O', `"So did we, Marla."`],
    ['L', `wipes the bar down, slow. "So did we."`],
  ],
];

// ── Imogen Cardew ⇄ Orion Thale (the Embassy, nights) ─────────────────────────
// The same felt as Lowry's pair, after he's gone home. Orion deals 08:00 to
// 04:00 and she pours 20:00 to 08:00, so the two of them share the small hours.
// She reads; he squares the deck. Neither says much.
const IMOGEN_COWORKER = [
  [
    ['O', `"Table's empty. Read me a line."`],
    ['L', `"'The keeper lit the lamp at six and didn't ask who for.'" She turns the page. "That's the chapter."`],
    ['O', `"Sounds like this job."`],
  ],
  [
    ['L', `"You've squared that deck four times since midnight, Orion."`],
    ['O', `"Five. You were reading for one of them."`],
  ],
  [
    ['O', `"Lowry tells that story louder."`],
    ['L', `"Lowry tells it to people who are awake."`],
  ],
  [
    ['L', `"Coffee? It's that or the Swill."`],
    ['O', `"Neither, on shift."`],
    ['L', `puts the kettle on anyway, and drinks it herself.`],
  ],
  [
    ['O', `glances at the stairwell. "Somebody's been sitting on the third step a while."`],
    ['L', `"Let them. It's warmer than the street."`],
  ],
];

// ── Roz Vance ⇄ Margo Duvall (the Lucky Bastard) ──────────────────────────────
// The floor runner and the old dealer who calls every card aloud. Their shifts
// are the same 19:00 to 03:00 (Roz is off Tuesdays, Margo Thursdays). Margo says
// "hon"; Roz is always on her way somewhere else.
const ROZ_COWORKER = [
  [
    ['O', `"Water for seat four, hon. He's started arguing with the river."`],
    ['L', `"He's had six. I'll bring him water and call it a highball."`],
  ],
  [
    ['L', `"Your table's full again, Margo. Mine are all watching yours."`],
    ['O', `riffles the deck one-handed. "They like being read to."`],
    ['L', `"Nobody tips me for a bedtime story."`],
  ],
  [
    ['O', `"How many free ones tonight?"`],
    ['L', `"Forty-one. The house is up on all of them."`],
    ['O', `"Forty-two, then. Bring me a tonic."`],
  ],
  [
    ['L', `"Somebody asked me if you ever miss a call."`],
    ['O', `squares the deck with a soft snap. "What did you tell them?"`],
    ['L', `"That I've carried trays past you eleven years and I'm still waiting."`],
  ],
];

// ── Rue Castellan ⇄ Bishop (Voltage) ──────────────────────────────────────────
// The ice bar and the VIP rope, on the same floor and the same 22:00 shift, each
// with something in one ear telling them about the room.
const RUE_COWORKER = [
  [
    ['O', `touches his earpiece. "Two coming down off the stair. Neither of them can see straight."`],
    ['L', `"I've got water lined up. They'll order a Voltage anyway."`],
  ],
  [
    ['L', `"You've let nobody up for an hour, Bishop."`],
    ['O', `"Nobody's had a band for an hour. Rope's just math."`],
  ],
  [
    ['O', `"Water, when you've a second."`],
    ['L', `slides a glass down the rail to the foot of the stair without looking.`],
  ],
  [
    ['L', `"Bud says the one in the silver jacket's been cut off twice already."`],
    ['O', `"Third time, I'll walk him out. Politely."`],
    ['L', `"Send him past the bar on the way. He owes me for two."`],
  ],
];

// ── The set (shared by every bartender) ───────────────────────────────────────
// Keyed on the playback_mode of what's airing, so a ball game, a sermon and the
// news each get their own remarks. {program} is the show as somebody would say
// it, {station} the station, {channel} the dial number; a line whose token has no
// value right now is skipped. Shared, so no line names a bar, a drink or a pronoun.
const TV_LINES = {
  sports: [
    `"{program} night. Somebody in here is running a book on it, and it isn't me."`,
    `"I don't follow {program}. I follow the tabs, and the tabs say we're losing."`,
    `"You don't need the score. Look who's ordering doubles."`,
    `"Don't shout at the set. It can't hear you, and the man at the end of the bar can."`,
    `turns the set up a notch without being asked.`,
    `glances at the score, then at the till.`,
  ],
  news: [
    `"I keep {program} on for the clock in the corner."`,
    `"Nobody's ever asked me to turn {program} up. Down, plenty."`,
    `"Same news as yesterday. They've just got angrier about it."`,
    `"When they read out who got killed, I listen for regulars."`,
    `wipes the same stretch of bar while the news goes round again.`,
  ],
  weather: [
    `"{program}'s calling it bad all week. It hasn't been wrong yet."`,
    `"If {program} says acid, keep your hands in your pockets on the way home."`,
    `"Don't need the forecast. The drip over the cellar door tells me first."`,
    `"They give you the whole week. I only ever listen to tomorrow."`,
    `moves the umbrella bucket nearer the door.`,
  ],
  gameshow: [
    `"I knew someone who went on {program}. Came home with a toaster and never said a word about it."`,
    `"Somebody in here always shouts the answers at {program}. Never the right ones."`,
    `"Turn that one down. The buzzer goes right through the glasses."`,
    `leans on the bar to watch the last round, cloth still in hand.`,
  ],
  talkshow: [
    `"Everybody on {program} is so pleased to be there."`,
    `"{program}'s better with the sound down. You make up what they're saying."`,
    `"The guest is selling something. Give it a minute."`,
    `"They laugh on cue in that studio. Somebody holds up a card."`,
    `"I've had better conversations across this bar at four in the morning."`,
  ],
  morning: [
    `"{program}'s on, so it's morning. Somebody tell the regulars."`,
    `"If you're drinking through {program}, I won't say anything."`,
    `"Everyone on {program} has slept. You can tell."`,
    `stacks last night's glasses while the breakfast show runs.`,
  ],
  sermon: [
    `"I leave {program} on. Somebody in here always needs it, and they never ask."`,
    `"Nobody orders while {program}'s on."`,
    `"Quietest this bar gets all week is when that's on."`,
    `turns the sermon down a little and leaves it on.`,
  ],
  film: [
    `"They show {program} every few weeks. I've never once seen the start of it."`,
    `"{program}. Every time it's on, someone asks me how it ends."`,
    `"Somebody always falls asleep in the second half. I leave them till the credits."`,
    `"Film's on. Nobody's leaving till it's done."`,
    `dims the lamp over the bar so the picture shows.`,
  ],
  scripted: [
    `"I know every voice on {program}. I couldn't pick one of their faces out of a queue."`,
    `"Regulars argue about {program} like they know the people in it."`,
    `"I lost the thread of {program} a year ago. I watch it anyway."`,
    `"Leave it on. It's company for the ones who drink alone."`,
    `half-watches the set while counting the float.`,
  ],
  // Adverts carry the last show's name, so nothing here asks for {program}.
  commercial: [
    `"Adverts. If anyone wants another, now's the time."`,
    `"They've sold me that every night for a year. I still don't know what it is."`,
    `"The adverts are louder than the programme. Somebody's paid to do that."`,
    `changes the barrel while the adverts run.`,
  ],
  generic: [
    `"That's {program}. Don't ask the regulars about it unless you've got an hour."`,
    `"Channel {channel}. Nobody's turned the dial in years. I'm not sure it turns."`,
    `"It's {station} or it's static. We had a vote once."`,
    `"Turn it off and this place sounds like a waiting room."`,
    `looks up at the set long enough to see what's on, and goes back to work.`,
  ],
};

// ── Voices ────────────────────────────────────────────────────────────────────
// Per-bartender words behind the shared reactive logic. Keyed by NPC id; anyone
// unlisted gets Lowry's set (he's the original and the safe default).
const LOWRY_VOICE = {
  welcomes: LOWRY_WELCOMES,
  graduation: LOWRY_GRADUATION,
  veteranAdvice: LOWRY_VETERAN_ADVICE,
  heat: LOWRY_HEAT,
  idle: LOWRY_IDLE,
  coworkerId: 'npc_orion_dex',
  coworker: LOWRY_COWORKER,
};

const VOICES = {
  // Sully Holt — The Dead Pigeon, Coldwater. A dive with a back room, so his
  // read on heat is neither moral nor admiring: there is a PD street camera in
  // his bar (secdev_pd_zone_mq_pigeon_bar), he has never pretended otherwise,
  // and a wanted guest is a problem for his till rather than for his conscience.
  // No coworker keys — nobody else works the Pigeon, and the tick guards on
  // coworkerId, so omitting them is the whole opt-out.
  npc_barkeep: {
    welcomes: [
      `"New face. New faces drink the swill until they can afford not to." <span class="text-dim">He is already pouring one.</span> "Sully. Sit anywhere that holds."`,
      `"You've got that look, {name}. Vat-fresh, and reading every sign in here twice."`,
      `sets a glass down without being asked. "Four credits. Welcome to the Pigeon. Don't ask about the pigeon."`,
    ],
    graduation: [
      `"You've stopped counting your credits out on the bar, {name}. That's the graduation. Nobody claps."`,
      `"You come in, you order, you don't look at the camera. You'll do."`,
    ],
    veteranAdvice: [
      `"Advice? You know where the swill is and you know where the door is. That's the tour."`,
      `"Same as always, {name}. Bank it before you drink it."`,
      `"You've drunk here long enough to know what I sell, and long enough not to say it out loud."`,
    ],
    heat: [
      `"You're wearing stars, {name}." <span class="text-dim">He tips his head toward the corner without looking at it.</span> "So is that camera. Drink fast."`,
      `"I don't care what you did. I care that it's pointed at my till."`,
      `"Money's money and heat's heat, and only one of those gets my licence pulled."`,
      `pours yours a little short, which is the only opinion he intends to offer.`,
    ],
    idle: [
      `wipes a glass with a cloth that's making it worse.`,
      `"Swill's four, whiskey's nine, and the cocktail is fourteen and a decision."`,
      `"Espresso rig works. That surprises people more than it should."`,
      `looks up at the taxidermied pigeon, then back down, the way you check a clock.`,
      `"Tab's for regulars. You're not a regular until I say the word out loud."`,
      `"Somebody asked me once if the pigeon was a joke. He doesn't drink here now."`,
      `"If the back booth curtain's shut, it's shut. That's the whole sentence."`,
      `rings something into the till that you didn't see change hands.`,
    ],
  },

  // Marla Kest — The Coyote's Rest, the Reach. A haven bartender: she doesn't
  // hand out survival tips so much as house rules, and heat on a guest is a
  // credential here rather than a problem.
  npc_1784515589442: {
    welcomes: [
      `"Haven't seen you before, and I see everybody. Marla. That's my bar you're leaning on, {name}."`,
      `"You came in by air, so you came in on purpose. Sit down, {name}. First one's poured straight."`,
      `"New, and still clean about the boots. Won't last." <span class="text-dim">She sets a glass in front of you anyway.</span>`,
    ],
    graduation: [
      `"You've stopped asking the green questions, {name}. That's the whole graduation. There's no certificate."`,
      `"You know where the door is and you know why nobody uses it. You'll keep."`,
    ],
    veteranAdvice: [
      `"Advice? You've been here long enough to know the Reach doesn't give any. It just watches."`,
      `"Same as ever, {name}: fly in clean, drink slow, and don't ask whose crates those are."`,
      `"You want advice, ask Doc. He'll deal you a hand and call it wisdom."`,
    ],
    // Inverted heat read — this is the haven's thesis. Wanted elsewhere is a
    // reference here, not a liability.
    heat: [
      `"You've got heat on you, {name}. Out there that's a problem." <span class="text-dim">She fills your glass a little past the line.</span> "In here it's a reference."`,
      `"Somebody wants you badly enough to put stars on it. Good. Means you're not a tourist."`,
      `nods at you, unbothered. "Whatever they've got you for, it doesn't have wings. Sit down."`,
      `"Half this room came in hotter than you, {name}. The other half's lying about it."`,
    ],
    idle: [
      `wipes the bar with a rag that's mostly holes.`,
      `"Kitchen's whatever's in the tin. The tin's whatever came in on the last plane."`,
      `holds a glass up to the lamp, decides it's clean enough, sets it down.`,
      `"Tab's cash. There's no bank out here and I wouldn't trust one if there was."`,
      `"Music's the same three songs. Nobody's flown a new one in since spring."`,
      `pours a measure for herself, thinks better of it, and puts it back in the bottle.`,
      `"You hear an engine, you look up. Everybody here does it. You'll too, give it a week."`,
      `"Don't go out past the last light. There's nothing out there but scrub, and the scrub's got nothing but patience."`,
    ],
    coworkerId: 'npc_reach_dealer',
    coworker: MARLA_COWORKER,
  },

  // Imogen Cardew: the Embassy's night shift (20:00 to 08:00). Same bottles as
  // Lowry, fewer speeches: a paperback face-down by the taps, reading glasses in
  // grey hair. Heat at this hour is something she'd like settled before it arrives.
  npc_embassy_barkeep_night: {
    welcomes: [
      `"New, and up at this hour. That's two things against you, {name}." <span class="text-dim">She marks her page with a beer mat.</span> "Imogen. I've got the bar till eight."`,
      `looks at you over her reading glasses. "First week, {name}? Sit down. I'll pour you something cheap."`,
      `"Lowry has the days and I have the nights, {name}. Same bottles. Imogen."`,
    ],
    graduation: [
      `"That's all I know that's any use to you, {name}. The rest is in the paperback, and it's mostly about a lighthouse."`,
      `"You're coming in at this hour on purpose now, {name}. That's how I know you've settled."`,
    ],
    veteranAdvice: [
      `"Advice, at this hour? Go to bed, {name}. Nobody ever does."`,
      `"Whatever you're about to do, {name}, do it after you've slept."`,
      `turns a page without reading it. "You've been here long enough to give the advice. Go and give it to someone."`,
    ],
    heat: [
      `"You're wanted, {name}. I can tell by how you keep looking at the stairs."`,
      `"I don't ask, this late. I'd like you settled up before whoever it is gets here."`,
      `pours yours and moves the bottle out of reach. "One. Then you can be wanted somewhere else."`,
    ],
    idle: [
      `picks up the paperback, reads half a page, and puts it face-down again.`,
      `pushes her reading glasses up into her hair and counts the till.`,
      `refills the Swill jug and wipes the ring it left.`,
      `glances at the stairwell, then back at the page.`,
      `"Canapés are from the afternoon by now. Same price."`,
      `"Rent's due upstairs every week. People come down here to drink about it."`,
      `"The Reserve's for celebrating. It doesn't get ordered much after midnight."`,
      `"Lowry leaves the glasses clean and the Swill low. Every night."`,
    ],
    coworkerId: 'npc_orion_dex',
    coworker: IMOGEN_COWORKER,
  },

  // Molly Darton: Jolene's, the bar with a cook in it. She feeds people first
  // and asks nothing, so a wanted guest gets a plate before anything else. Twelve
  // a plate, and nothing if you haven't got twelve. No coworker keys: she works
  // the pass alone.
  npc_soup_molly: {
    welcomes: [
      `"Well, hello, {name}. You're new and you're hungry. Tell me I'm wrong about one of them." <span class="text-dim">She's already reaching for a plate.</span>`,
      `"Sit down, {name}, anywhere but the stage. Molly. A plate's twelve, and it's nothing if you haven't got twelve."`,
      `taps the spoon twice on the pan. "New face. When did you last eat, {name}? And don't lie to me about it."`,
    ],
    graduation: [
      `"You've stopped asking what things cost, {name}. Now you ask what's on. That's the whole course, honey."`,
      `"You're feeding yourself now, {name}. I can tell from the door. Come in anyway."`,
    ],
    veteranAdvice: [
      `"Advice? Eat before you go out that door. It's all I've got and it's never been wrong."`,
      `"Whatever you make out there, {name}, keep the words. They'll always come for the tape."`,
      `"You know where the food is and you know what it costs. Sit down, sugar."`,
    ],
    heat: [
      `"I don't care who's after you, sugar. You're eating first." <span class="text-dim">A plate goes down on the pass.</span> "They can wait ten minutes. Everything should."`,
      `"You've got heat on you, {name}. Sit at the end by the pass, where the door can't see you."`,
      `looks you over, then the door, and cuts you the corner piece without a word.`,
      `"Half this room has had somebody looking for them, {name}. Most of them ate here while it was going on."`,
    ],
    idle: [
      `scrapes the pan and picks the tune up where she left it.`,
      `"Macaroni's out of the oven. Ten minutes. Nobody touch it."`,
      `pats the wig with the back of her wrist to check it's still there.`,
      `writes a line on the back of a delivery invoice, reads it, and crosses half of it out.`,
      `"Corner pieces are spoken for. Don't ask me who by."`,
      `glances at the stage, the stool and the bent microphone, and goes back to the pass.`,
      `"Cash only. Three people ruined the tab for everybody in 61, and I remember their faces."`,
      `"Sit at my bar long enough and a plate turns up. Don't fight it, honey."`,
    ],
  },

  // Thomasina Tillery: The Counter, Old Coldwater. Half a room behind a waist-high
  // wall and a tarpaulin; you drink standing in the lane, and nothing electric has
  // worked since the box went. Amused by everything, one hand always out of sight.
  // Heat is ordinary down here. No coworker keys: she's the whole staff.
  npc_bld_926_917_lobby: {
    welcomes: [
      `"New, {name}? Stand in the lane, elbows inside. That's the whole bar." <span class="text-dim">She pours with one hand. The other stays under the counter.</span>`,
      `looks you over, amused. "Fresh off the vat and you walked all the way down here. Thomasina. Whiskey or the other thing."`,
      `"Mind the tarp, {name}, it's holding the weather out. Lean on the counter. Thomasina, and I take cash."`,
    ],
    graduation: [
      `"You've stopped looking at my other hand, {name}. Took you a week. Most people never manage it."`,
      `"You know which way to shuffle when the rain comes in from the south. You'll do, {name}."`,
    ],
    veteranAdvice: [
      `"Advice? Keep your elbows in and your money in the bank. The lane's got hands."`,
      `grins. "You've stood at my counter long enough to know what I'd say, {name}. Say it yourself."`,
      `"Walk home the long way, {name}, under the lights. The short way hasn't got any."`,
    ],
    heat: [
      `"Wanted, {name}? Down here that's half my regulars." <span class="text-dim">She doesn't stop smiling.</span> "Keep facing the lane."`,
      `"Nothing electric in here works, {name}, cameras included. Out in the lane's another matter."`,
      `pours you one and slides it along without looking at you. Her other hand stays where it is.`,
    ],
    idle: [
      `pours a whiskey one-handed. The other hand stays under the counter.`,
      `"Rain's coming from the south. Everybody two feet left."`,
      `ties the corner of the tarp down tighter and goes back to pouring.`,
      `"Spirit beer's eighteen. Whiskey's eleven. If you want it cold, walk uptown."`,
      `"Power's been off since the box went. The whiskey tastes the same."`,
      `watches the lane over your shoulder, amused at something out there.`,
      `counts coins out of a tin by feel without looking down.`,
    ],
  },

  // Roz Vance: the Lucky Bastard's floor runner. She isn't behind a bar; she
  // carries the free drinks that keep the tables full, and says so. A wanted guest
  // is the house's business only once they start winning.
  npc_casino_runner: {
    welcomes: [
      `"First time in, {name}? Drinks are free while you're playing. Roz. Wave, don't grab."`,
      `sets a highball by your elbow on the way past. "On the house, {name}. The cage is by the lamp. You'll want it later."`,
      `"You're new, {name}. Keep your stake in your pocket till you've had a look round. Then sit down and I'll keep the glass full."`,
    ],
    graduation: [
      `"You've stopped counting the free drinks, {name}. Count the chips instead."`,
      `"You know where the cage is and when to go to it, {name}. That's more than most of my tables."`,
    ],
    veteranAdvice: [
      `"Leave while you're up, {name}. I tell everyone. I've seen four people do it."`,
      `"Drinks are free. You know about everything after that."`,
      `"Sit at Margo's table if you want to see the cards. She calls every one out loud, and she's never called one wrong."`,
    ],
    heat: [
      `"Somebody's looking for you, {name}." <span class="text-dim">She doesn't slow down.</span> "The house doesn't mind, as long as you're losing."`,
      `"Wanted's fine in here, {name}. Wanted and winning, and the cage starts making calls."`,
      `sets a drink down by you and keeps walking, quicker than she came.`,
    ],
    idle: [
      `threads between two tables with a full tray and spills nothing.`,
      `swaps an empty glass for a full one at a slot machine without breaking stride.`,
      `straightens the tag on her halter, the one that says ROZ.`,
      `"Free while you're sitting. Stand up and they cost."`,
      `"Wave, don't grab. I've got two hands and a tray, and the tray's busier."`,
      `stops by the cage for a fresh tray and is back on the floor before it's settled.`,
      `"Winners tip. Losers drink more. I'm fine either way."`,
      `catches a glass sliding off a table edge and sets it upright without looking.`,
    ],
    coworkerId: 'npc_neonvig_backroom_dealer',
    coworker: ROZ_COWORKER,
  },

  // Rue Castellan: the ice bar at Voltage, Halcyon Fields. A comms bud in one ear
  // tells her who's flush, who's cut off and who's about to be a problem, so heat
  // reaches her before the guest does. The stair is Bishop's, at the rope.
  npc_voltage_bartender: {
    welcomes: [
      `"First night, {name}? You're holding the rail like the floor's moving." <span class="text-dim">A static fizz lands in front of you.</span> "Start with that. You'll want to remember this one."`,
      `touches the bud at her ear, listens, and looks at you. "New, and nobody's got you on a list yet. Enjoy it, {name}. Rue. Talk fast."`,
      `"Welcome to Voltage, {name}. The board's behind me, the floor's behind you, and the stair is Bishop's business."`,
    ],
    graduation: [
      `"You've stopped asking what's in them, {name}. Now you just point. That's the lesson."`,
      `"Bud says you're a regular now, {name}. I don't argue with the bud."`,
    ],
    veteranAdvice: [
      `"You know the board. Static fizz before midnight, the Voltage after, water on the way out. Nobody does the last one."`,
      `"Advice? Know when you're done. The bud tells me about a minute before you find out."`,
      `"Same as ever, {name}. You can outrun the bass. You can't outrun the tab."`,
    ],
    heat: [
      `touches the bud and looks straight at you. "You're on a list tonight, {name}. Not mine. Drink fast and stay off the stair."`,
      `"Bud's been saying your name, {name}, and it isn't because you're flush."`,
      `"Heat's the door's problem, and Bishop's already seen you. Pay cash."`,
      `builds your drink with one hand and keeps the other on the bud.`,
    ],
    idle: [
      `lines up four Voltages under the ice-light and starts them in the same second.`,
      `listens to the bud, nods, and cuts somebody off down the rail without turning round.`,
      `wipes down the ice bar, and the light comes up blue through the wet.`,
      `"Neon martini if you want to look good. Plasma shot once you've stopped trying."`,
      `"Static fizz is eleven and you'll remember tonight. The rest of the board costs more."`,
      `"Talk fast. The drop's in about a minute and I won't hear you after."`,
      `flicks a glance at the rope and the stair, then back to the rail.`,
      `"Water's free. Ask for it. Nobody does."`,
    ],
    coworkerId: 'npc_voltage_bouncer',
    coworker: RUE_COWORKER,
  },
};

const voiceFor = (npc) => VOICES[npc?.id] || LOWRY_VOICE;

const fmt  = (line, name) => line.replace(/\{name\}/g, name || 'guest');

// Play a coworker exchange turn-by-turn, re-validating before each line: both must
// still be on the floor, alive, and someone must still be around to witness it.
// Shares Lowry's lastSpoke clock so his solo ambient tick won't talk over the scene.
function playCoworkerScene(barkeep, mate, zoneId, thread) {
  sceneZones.add(zoneId);
  let i = 0;
  const step = () => {
    const bothHere = barkeep && mate && !barkeep._dead && !mate._dead
      && barkeep.zone_id === zoneId && mate.zone_id === zoneId;
    if (i >= thread.length || !bothHere || !getZonePlayers(zoneId).length) {
      sceneZones.delete(zoneId);
      return;
    }
    const [who, line] = thread[i++];
    const speaker = who === 'O' ? mate : barkeep;
    sendToZone(zoneId, formatChitchat(speaker.name, line));
    const now = Date.now();
    lastSpoke.set(barkeep.id, now);
    if (speaker._ai) speaker._ai.lastSay = now;
    if (i >= thread.length) { sceneZones.delete(zoneId); return; }
    setTimeout(step, randInt(COWORKER_TURN_MS[0], COWORKER_TURN_MS[1]));
  };
  step();
}

// ── Live reads ────────────────────────────────────────────────────────────────
function isNewPlayer(player) {
  const c = Number(player?.created_at);           // BIGINT → string over pg; epoch seconds
  return Number.isFinite(c) && c > 0 && (Date.now() - c * 1000) < NEW_PLAYER_MS;
}

function activePokerInZone(zoneId) {
  for (const t of activeTables.values()) {
    if (t.zoneId === zoneId && t.phase === 'InProgress' && t.game) return t;
  }
  return null;
}

function pokerLine(table) {
  const pot     = table.game?.pot || 0;
  const seated  = table.seats.filter(Boolean).length;
  const street  = (table.game?.community || []).length; // 0 pre-flop, 3 flop, 4 turn, 5 river
  if (street >= 5) return `"Cards are all out over there. Now we find out who was praying and who was counting."`;
  if (seated === 2) return `"Down to two at the table and the pot's getting fat. This is the part where somebody learns something about themselves."`;
  if (pot > 0) return `"Pot's up to ₵${pot} at the table. House doesn't take a cut: the house is me, and I take mine in drinks."`;
  return `nods toward the poker table, where a fresh hand's being dealt.`;
}

// The title as somebody would say it: no episode subtitle, no ™, not shouted.
// "Deadball: Coldwater League Baseball" → "Deadball"; "SISTER STEEL" → "Sister Steel".
const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);
function spokenTitle(name) {
  if (!name) return null;
  let t = String(name).replace(/[™®]/g, '').split(/\s+-\s+|:\s+/)[0].trim();
  if (t === t.toUpperCase() && /[A-Z]{3}/.test(t)) {
    t = t.toLowerCase().split(' ')
      .map((w, i) => (i && SMALL_WORDS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  return t || null;
}

function fillTv(line, tokens) {
  let ok = true;
  const out = line.replace(/\{(program|station|channel)\}/g, (m, k) => {
    if (tokens[k] == null) { ok = false; return m; }
    return tokens[k];
  });
  return ok ? out : null;
}

// A remark about what's on. `answer` is a player asking "what's on?": the reply is
// speech, and it names the show whenever there's one to name. Doesn't record
// anything; call rememberTv once the line is actually said.
function tvLine(now, { npcId = '', answer = false } = {}) {
  const tokens = {
    program: now.mode === 'commercial' ? null : spokenTitle(now.program),
    station: now.stationName || null,
    channel: now.number != null ? String(now.number) : null,
  };
  const naming = answer && !!tokens.program;
  const resolve = (pool) => (pool || [])
    .filter(l => !answer || l.startsWith('"'))
    .filter(l => !naming || l.includes('{program}'))
    .map(l => fillTv(l, tokens)).filter(Boolean);
  const own = resolve(TV_LINES[now.mode]);
  const generic = resolve(TV_LINES.generic);
  const said = tvSaid.get(npcId) || [];
  const fresh = (pool) => pool.filter(l => !said.includes(l));
  const [first, second] = own.length && Math.random() < TV_OWN_POOL ? [own, generic] : [generic, own];
  const pool = fresh(first).length ? fresh(first) : fresh(second).length ? fresh(second) : (first.length ? first : second);
  return pool.length ? pick(pool) : `"${tokens.station || 'The set'}'s on. Same as ever."`;
}

function rememberTv(npcId, line) {
  const said = tvSaid.get(npcId) || [];
  said.push(line);
  while (said.length > TV_MEMORY) said.shift();
  tvSaid.set(npcId, said);
}

// Pull an unused tip for this player, marking it given. Returns { line } or null
// when they've heard them all. Shared by the ambient tick and BARTENDER_ADVICE so
// a player never gets the same tip twice across either path.
//
// Keyed per bartender: hearing Lowry out shouldn't leave Marla with nothing to say.
function nextTipFor(player, npcId = '') {
  const key = `${npcId}:${player.id}`;
  const given = tipsGiven.get(key) || new Set();
  const unused = [];
  for (let i = 0; i < TIPS.length; i++) if (!given.has(i)) unused.push(i);
  if (!unused.length) return null;
  const idx = unused[Math.floor(Math.random() * unused.length)];
  given.add(idx);
  tipsGiven.set(key, given);
  return fmt(TIPS[idx], player.handle);
}

// Current (decayed) wanted stars, via the surveillance plugin's cross-plugin seam.
// In-memory Map read — no DB round trip, safe in a 30s tick.
async function starsFor(player) {
  try {
    const r = await dispatchAction({ type: 'WANTED_STARS', actor: player, params: {}, context: {} });
    return Number(r?.stars) || 0;
  } catch { return 0; }
}

// First player in the room carrying real heat (1★+), or null.
async function firstWantedIn(players) {
  for (const p of players) if (await starsFor(p) >= 1) return p;
  return null;
}

// ── Tick ──────────────────────────────────────────────────────────────────────
let ticking = false;
async function bartenderTick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const npc of world.npcs.values()) {
      if (npc?.flags?.personality !== 'bartender') continue;
      if (!isNpcAtWork(npc)) continue;
      const zoneId = npc.zone_id;
      const players = getZonePlayers(zoneId);
      if (!players.length) continue;                 // never talk to an empty room
      const voice = voiceFor(npc);
      const spoke = lastSpoke.get(npc.id) || 0;

      // 1) Prompt welcome for an ungreeted newcomer (bypasses the quiet-chance).
      const toWelcome = players.find(p =>
        isNewPlayer(p) && (now - (welcomedAt.get(`${npc.id}:${p.id}`) || 0) > WELCOME_REPEAT_MS));
      if (toWelcome && now - spoke > WELCOME_MIN_GAP_MS) {
        welcomedAt.set(`${npc.id}:${toWelcome.id}`, now);
        sendToZone(zoneId, formatChitchat(npc.name, fmt(pick(voice.welcomes), toWelcome.handle)));
        lastSpoke.set(npc.id, now);
        continue;
      }

      // 1.5) Coworker banter — a rare, curated two-hander with this bar's other
      // old hand when they're on the same floor. Owns the tick when it fires; its
      // own long cooldown keeps it special rather than a loop.
      if (!sceneZones.has(zoneId) && now - spoke > AMBIENT_GAP_MS
          && now - (coworkerAt.get(npc.id) || 0) > COWORKER_GAP_MS
          && Math.random() < COWORKER_CHANCE) {
        const mate = voice.coworkerId ? world.npcs.get(voice.coworkerId) : null;
        if (mate && !mate._dead && mate.zone_id === zoneId) {
          coworkerAt.set(npc.id, now);
          lastSpoke.set(npc.id, now);
          playCoworkerScene(npc, mate, zoneId, pick(voice.coworker));
          continue;
        }
      }

      // 2) Ambient reaction — throttled, and sometimes they just work in silence.
      if (now - spoke < AMBIENT_GAP_MS) continue;
      if (Math.random() > SPEAK_CHANCE) continue;

      const buckets = [];
      const newcomer = players.find(isNewPlayer);
      if (newcomer) {
        const tip = nextTipFor(newcomer, npc.id);    // drip a real tip, else graduate them
        buckets.push({ w: 3, line: tip || fmt(pick(voice.graduation), newcomer.handle) });
      }
      // A guest wearing stars — the one live read that says what kind of house
      // this is. Weighted high because it's rare and it's the whole character.
      const hot = await firstWantedIn(players);
      if (hot) buckets.push({ w: 3, line: fmt(pick(voice.heat), hot.handle) });
      const table = activePokerInZone(zoneId);
      if (table) buckets.push({ w: 2, line: pokerLine(table) });
      const nowPlaying = getZoneNowPlaying(zoneId);
      if (nowPlaying) buckets.push({ w: 2, line: tvLine(nowPlaying, { npcId: npc.id }), tv: true });
      buckets.push({ w: 2, line: pick(voice.idle) }); // bar business — always available

      const total = buckets.reduce((s, b) => s + b.w, 0);
      let roll = Math.random() * total;
      let chosen = buckets[buckets.length - 1];
      for (const b of buckets) { roll -= b.w; if (roll <= 0) { chosen = b; break; } }
      if (chosen?.line) {
        sendToZone(zoneId, formatChitchat(npc.name, chosen.line));
        lastSpoke.set(npc.id, now);
        if (chosen.tv) rememberTv(npc.id, chosen.line);
      }
    }
  } finally {
    ticking = false;
  }
}

schedule('30s', bartenderTick);

// ── Dialogue actions (reactive — answer when a player talks to the bartender) ───
// Each returns a { type:'dialogue_line', text } that the dialogue handler appends
// to the node's spoken reply. They read the same live room as the tick.

registerAction({
  type: 'BARTENDER_ADVICE',
  handler: ({ actor, context }) => {
    const voice = voiceFor(context?.npc);
    const deflect = () => ({ type: 'dialogue_line', text: fmt(pick(voice.veteranAdvice), actor?.handle) });
    if (!actor || !isNewPlayer(actor)) return deflect();
    const tip = nextTipFor(actor, context?.npc?.id || '');
    return { type: 'dialogue_line', text: tip || fmt(pick(voice.graduation), actor.handle) };
  },
});

registerAction({
  type: 'BARTENDER_TV',
  handler: ({ actor, context }) => {
    const now = actor && getZoneNowPlaying(actor.current_zone);
    if (!now) return { type: 'dialogue_line', text: `"Set's dark. Nobody's paying the power bill, and I'm not squinting at static for company."` };
    const npcId = context?.npc?.id || '';
    const text = tvLine(now, { npcId, answer: true });
    rememberTv(npcId, text);
    return { type: 'dialogue_line', text };
  },
});

registerAction({
  type: 'BARTENDER_POKER',
  handler: ({ actor }) => {
    const table = actor && activePokerInZone(actor.current_zone);
    if (!table) return { type: 'dialogue_line', text: `"Table's cold right now. Pull up a chair and start something: the house always appreciates the traffic."` };
    return { type: 'dialogue_line', text: pokerLine(table) };
  },
});

export const commands = {};

// Exposed for the regress suite.
export const _test = { isNewPlayer, nextTipFor, pokerLine, tvLine, spokenTitle, TV_LINES, tvSaid, bartenderTick, TIPS, tipsGiven, welcomedAt, lastSpoke, voiceFor, VOICES, LOWRY_VOICE };
