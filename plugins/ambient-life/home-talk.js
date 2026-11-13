// Home talk: what two people who live together say to each other when nobody needs them.
//
// The engine's banter (server/engine/npc-banter.js) plays a fixed thread from a library, anywhere. This is
// the at-home half, and it's built rather than played: a topic is a short ladder of steps, each step a few
// alternative lines, and which rung comes next depends on how the talk is going. Every pair of flatmates
// has a TEMPER that moves line by line ('+' on a line raises it, '-' lowers it), and a fork step reads it:
// calm talk stays calm, a heated one goes somewhere else. On top of that:
//
//   • MEMORY. A pair remembers, in RAM, the last thing they fell out over and the last joke that landed.
//     A later talk can open on the grudge ("Are we still not talking about the soup?") or bring the joke
//     back. Forgotten on restart, which is about how long a real grudge over soup should last.
//   • INTERRUPTIONS. The pipes bang, a drone hits the window, the neighbour shouts through the wall. Each
//     gets a reaction, and some knock the talk onto a different topic altogether.
//   • THE WITNESS. A stranger standing in the kitchen gets talked about, in front of them.
//   • CONSEQUENCES. A talk that ends hot can send one of them off to the bathroom to sulk (the real trip,
//     through home-life's playBathroom), and leaves a grudge the next talk can pick up.
//
// Lines follow formatChitchat: a fully "quoted" line is speech, anything else is an emote after the name.
// Tokens: {me} {you} are the speaker and the other one (first names), {dish} {drink} come from the live
// catalogues, {neighbour} is someone else in the city, {weather} {phase} {grudge} {joke} {tv} as named.
// A line that needs a token with no value right now is skipped for another alternative.
//
// ⚠ RAM ONLY, NO WRITES. Same rules as home-life: home, off shift, awake, lights on, a witness re-checked
// before every line.

import { world, getZonePlayers } from '../../server/engine/world.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { formatChitchat } from '../../server/engine/ai-behaviour.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { eligibleNpcs, holdBanterZone } from '../../server/engine/npc-banter.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { emit } from '../../server/engine/events.js';
import { randInt } from '../../server/engine/util.js';
import { DISHES } from '../cooking/dishes.js';
import { DRINKS } from '../drinks/recipes.js';
import { zoneIsDark } from './blackout.js';
import { belongsHere } from './eviction.js';
import { tipsyOf } from './tipsy.js';
import { setNpcMood, npcMoodOf } from '../../server/engine/npc-mood.js';

const TURN_GAP_MS = [5000, 9000];
const INTERRUPT_CHANCE = 0.09;    // per line
const CALLBACK_CHANCE = 0.4;      // of opening on the pair's grudge or joke, when they have one
const MEMORY_MS = 6 * 3600_000;   // a grudge older than this is let go
const MAX_LINES = 12;

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const first = (npc) => String(npc?.name || 'someone').split(' ')[0];

// ── Memory ───────────────────────────────────────────────────────────────────
// pairKey → { temper, grudge, joke, talks, at }
const pairs = new Map();
const pairKey = (a, b) => [a.id, b.id].sort().join(':');
function memoryOf(a, b) {
  const k = pairKey(a, b);
  let m = pairs.get(k);
  if (m && Date.now() - m.at > MEMORY_MS) { m.grudge = null; m.temper = 0; }
  if (!m) pairs.set(k, m = { ids: [a.id, b.id], temper: 0, grudge: null, joke: null, talks: 0, at: Date.now() });
  return m;
}
// For home-life's solo scenes: the flatmate this NPC is currently not speaking to, if any.
export function sulkingAt(npc) {
  for (const m of pairs.values()) {
    if (!m.grudge || m.temper < 2 || Date.now() - m.at > MEMORY_MS) continue;
    if (m.ids[0] === npc.id) return world.npcs.get(m.ids[1]) || null;
    if (m.ids[1] === npc.id) return world.npcs.get(m.ids[0]) || null;
  }
  return null;
}

// ── Topics ───────────────────────────────────────────────────────────────────
// steps alternate speakers A, B, A, B; '@a ' or '@b ' at the start pins a line to one of them.
// A step is an array of alternatives read as lanes: a talk takes alternative N of every step (wrapping
// round a shorter one), so alternatives in the same position are written to follow on. Or { calm, hot } read off the temper (hot at 2 and over).
// Tags at the end of a line: #grudge marks the topic as the thing they fell out over, #joke:<text> saves
// the joke, #storm sends the speaker to the bathroom, #make-up clears the grudge.

const TOPICS = [
  { id: 'dishes', label: 'the washing up', steps: [
    [`"Whose turn is it to wash up?"`, `"Are you going to do those pans or are they just living there now?"`],
    [`"Mine. Tomorrow."`, `+"I did them yesterday."`, `"I'll do them when they're dirty."`],
    [`+"They're dirty now."`, `"You said that yesterday."`, `+"You didn't do them yesterday. I was here."`],
    { calm: [`-"Fine. I'll wash, you dry."`, `-"Fine, I'll do them after this."`],
      hot: [`+"I'll put them in your bed, see how you like that."`, `+"I'm buying paper plates and I'm not sharing them. #grudge"`] },
    { calm: [`-"Deal."`, `-sighs and goes to look for the sponge.`],
      hot: [`"You wouldn't."`, `+"Do it. I'll sleep on the sofa. #grudge"`] },
  ]},
  { id: 'food', label: 'the food', steps: [
    [`"Did you eat my {dish}?"`, `"Where's the {dish} gone? It was in the fridge."`],
    [`"What {dish}?"`, `"I thought it was going off."`, `"It didn't have your name on it."`],
    [`+"It had my name on it. I wrote it on the lid."`, `+"I made it this morning. It wasn't going off."`],
    { calm: [`-"Sorry. I'll make some more tomorrow."`, `-"All right, I owe you one. It was good, though."`],
      hot: [`+"Well, it was very nice. Compliments to you."`, `+"I'm labelling everything from now on. Everything. #grudge"`] },
    { calm: [`-"You'd better. #joke:the {dish}"`], hot: [`+"Label your own mouth. #grudge"`, `stares at the fridge in silence.`] },
  ]},
  { id: 'rent', label: 'the rent', steps: [
    [`"Rent's due on Friday."`, `"Have you got your half of the rent?"`],
    [`"Which Friday?"`, `"Mostly."`, `"I've got some of it."`],
    [`+"This Friday. The one coming."`, `+"How much is mostly?"`],
    { calm: [`"I'll have it. I'm owed money from {neighbour}."`, `"I'll pick up a shift. It'll be fine."`],
      hot: [`"I'll have it by Friday. Probably by Friday."`, `+"Can you cover me this month? Just this month."`] },
    { calm: [`-"Get it off {neighbour} then. Don't let them string you along."`, `-"All right. Don't leave it to Thursday night again."`],
      hot: [`+"That's what you said last month. #grudge"`, `+"I'm not your bank. #grudge"`] },
  ]},
  { id: 'noise', label: 'the snoring', steps: [
    [`"You were snoring again last night."`, `"Do you know you talk in your sleep?"`],
    [`"I don't snore."`, `"What did I say?"`],
    [`"You sounded like a cement mixer."`, `"You kept saying 'not the blue one'. Over and over."`, `"You asked someone called Margaret to put the gun down."`],
    [`"Cement mixers don't snore."`, `"I don't know what the blue one is."`, `"I don't know any Margarets."`],
    [`-"This one does. #joke:the cement mixer"`, `-"Neither do I. Don't pick the blue one, though. #joke:the blue one"`, `-"Well, she knows you. #joke:Margaret"`],
  ]},
  { id: 'architect', label: 'the Architect', steps: [
    [`"Do you think the Architect can hear us in here?"`, `"Do you ever think the Architect's watching us?"`],
    [`"Why would it want to?"`, `"Probably. I don't think it cares, though."`, `"I hope not. I've said some things in this flat."`],
    [`"It knew my shoe size. The advert came up the day after my old ones split."`, `"Someone has to care. It might as well be the thing that runs the water."`],
    [`"Everyone gets that advert."`, `"That's not caring. That's stock control."`],
    [`looks at the ceiling for a moment, then lowers their voice. "Thanks for the water, though."`, `"Well, I'm saying thank you to it. Just in case."`],
  ]},
  { id: 'clone', label: 'the clone thing', steps: [
    [`"If you died and they brought you back from the vat, would you still be you?"`, `"Have you ever been brought back?"`],
    [`"I'd be me enough to want my stuff back."`, `"Once. I don't want to talk about it."`, `"Ask me after."`],
    [`"I'd notice. I'd know you weren't the real one."`, `"What was it like?"`],
    [`"How?"`, `"Cold. And they lose your fillings."`],
    [`"You'd do your own washing up, for a start. #joke:the vat"`, `"I'd be suspicious if you were nicer."`, `"Huh. That's why your teeth are like that."`],
  ]},
  { id: 'deadball', label: 'the game', need: (c) => !!c.team, steps: [
    [`"Did you see {team} last night?"`, `"{team} are going to win it this year, I'm telling you."`],
    [`"Don't. I can't talk about it."`, `+"They're not. They never do."`, `"I fell asleep at half time."`],
    [`"I'm going to the Coliseum next game. You coming?"`, `+"They're top of the league!"`],
    { calm: [`"Only if you're buying."`, `-"Go on then. I'll bring the flask."`],
      hot: [`+"Have you ever even been to a game?"`, `+"At least I support a team that's trying."`] },
    { calm: [`-"Deal."`], hot: [`+"Once! It rained! #grudge"`, `"I'm not talking about this with you any more."`] },
  ]},
  { id: 'tv', label: 'the telly', need: (c) => !!c.tv, steps: [
    [`"What is this?"`, `"Who put this on?"`],
    [`"It's {tv}. It's good."`, `"It's {tv}. Shh, I'm watching it."`],
    [`"What's happening?"`, `"Is it the same one as last week?"`, `+"Can we watch something else?"`],
    [`"I don't know, I only just started following it."`, `"It's different now, the other one died."`, `+"No. I've waited all day for this."`],
    [`settles back to watch anyway.`, `"Fine. Wake me up at the end."`, `+"I'm hiding the remote next time. #grudge"`],
  ]},
  { id: 'weather', label: 'the weather', steps: [
    [`"Have you been out in {weather}?"`, `"Look at {weather}."`],
    [`"No, and I'm not going."`, `"I had to. My coat's still wet."`, `"It's not that bad."`],
    [`"You going out later?"`, `"It's meant to get worse."`],
    [`"Not for anything less than food."`, `"No. You can't make me."`, `"I might. I'm out of milk."`],
    [`"Get me some too, if you go."`, `"We're out of milk too, then."`],
  ]},
  { id: 'plans', label: 'the holiday', steps: [
    [`"We should go somewhere. Out past the Curtain, just for a weekend."`, `"I want to go away somewhere. Anywhere."`],
    [`"There's nothing out there."`, `"Where? There's nowhere to go."`],
    [`"There's the Reach."`, `"There's the sea. There's the beach."`],
    [`"The Reach is a smuggler's den."`, `"The beach is all glass now. That's not a beach."`],
    [`"So you're saying it's cheap."`, `"It's still a view."`],
    [`"I'm saying we'd get robbed."`, `-"Fine. We'll look at it on the map. #joke:the weekend away"`],
  ]},
  { id: 'neighbour', label: 'the neighbour', steps: [
    [`"Did you hear {neighbour} last night?"`, `"Did you hear what {neighbour} had in their flat?"`],
    [`"Hear what?"`, `"Everyone heard."`],
    [`"Shouting. Then a big thud. Then singing."`, `"They had a goose in there. A live one."`, `"They were crying in the stairwell. Then they were fine and went out."`],
    [`"Should we check on them?"`, `"That explains the feathers."`, `"That's just how they are."`],
    [`"No. Well, maybe tomorrow."`, `"I'll knock in the morning."`, `"Leave it. It's not our business."`],
  ]},
  { id: 'order', label: 'the orders', steps: [
    [`"Someone from the Long Watch was handing out leaflets on the corner."`, `"I'm thinking about joining one of the orders."`],
    [`"Did you take one?"`, `"Which one?"`, `+"You are not joining a cult."`],
    [`"I took four. They're good for the table leg."`, `"I don't know. Whichever has the best food."`, `+"They're not cults. Mostly."`],
    { calm: [`"The Ascendants do a lunch on Sundays, I heard."`, `-laughs. "Fair enough."`],
      hot: [`+"If you shave your head I'm moving out."`, `+"If you start chanting in here I'm moving out."`] },
    { calm: [`"Ask if they do a vegetarian option."`], hot: [`"I'll chant quietly. #grudge"`, `+"You're not my mum. #grudge"`] },
  ]},
  { id: 'job', label: 'work', steps: [
    [`"How was work?"`, `"How was your day?"`],
    [`"Fine."`, `"Awful."`, `"Long. My manager cried in the stockroom."`],
    [`"Just fine?"`, `"What happened?"`, `"Why?"`],
    [`"Just fine. Nobody died."`, `"Someone took my sandwich again. I'm going to find out who."`, `"Quarterly targets. We don't know who sets them."`],
    [`"That's a good day, then."`, `"Put something in the next one. Hot sauce."`, `"The Architect sets them. It sets all of them."`],
  ]},
  { id: 'smell', label: 'the smell', steps: [
    [`sniffs the air. "What's that smell?"`, `"Can you smell that?"`],
    [`"What smell?"`, `"I can't smell anything."`, `"It's been there since Tuesday."`],
    [`"That. That smell. Is it you?"`, `"It's coming from the cupboard."`],
    [`+"It's not me."`, `"I'll look in a minute."`],
    { calm: [`opens the cupboard and shuts it again very quickly.`, `"We'll open a window."`],
      hot: [`+"It's you. It's been you the whole time. #grudge"`, `+"Have a shower and then we'll see if it's still there."`] },
  ]},
  { id: 'dream', label: 'the dream', steps: [
    [`"I had a dream about you last night."`, `"I had the weirdest dream."`],
    [`"Was it a good one?"`, `"Go on."`],
    [`"You were a bus. I had to ride you to work."`, `"All my teeth fell out, but they were dice."`, `"You were running a fish shop on the moon."`],
    [`"Was I on time?"`, `"What did you roll?"`, `"How was business?"`],
    [`"No. You were the night bus. #joke:the night bus"`, `"Double six. Then I woke up."`, `"Terrible. No air."`],
  ]},
  { id: 'money', label: 'the money', steps: [
    [`"Did you move my credits?"`, `"I had twenty in this jar."`],
    [`"I borrowed some."`, `"What jar?"`, `"I paid the power with it."`],
    [`+"You borrowed it from a jar."`, `+"The one labelled 'not yours'."`, `+"With my credits."`],
    { calm: [`-"I'll put it back. With a bit extra."`, `-"Sorry. It was for the power."`],
      hot: [`"I thought it was a joke label."`, `+"There were no credits in it when I found it. There was a note."`] },
    { calm: [`-"You'd better. #joke:the jar"`], hot: [`+"Keep away from my jars. #grudge"`] },
  ]},
  { id: 'cat', label: 'the cat', steps: [
    [`"There's a cat on the fire escape again."`, `"I think we should get a cat."`],
    [`"Is it the grey one?"`, `"We can barely feed you."`],
    [`"No, it's got one ear."`, `"It'd catch the mice."`, `"I'd call it Doug."`],
    [`"Don't feed it."`, `"We don't have mice."`, `"You can't call a cat Doug."`],
    [`"I already did. It knows my name now."`, `"We have one mouse. I've seen him. He's very confident."`, `"Watch me. #joke:Doug"`],
  ]},
  { id: 'fixit', label: 'the tap', steps: [
    [`"The tap's dripping again."`, `"Did you tell the landlord about the window?"`],
    [`"I fixed it with tape."`, `"I told them twice."`],
    [`"You can't fix a tap with tape."`, `"What did they say?"`],
    [`"I fixed the last one with tape."`, `"They said 'noted'."`],
    [`"That's why it's dripping."`, `"So nothing, then."`, `"I'll get more tape."`],
  ]},
  { id: 'phone', label: 'your phone', steps: [
    [`"Who are you messaging?"`, `"Why do you keep looking at your tablet?"`],
    [`"Nobody."`, `"Just {neighbour}."`],
    [`"You're smiling at it."`, `"You've gone red."`],
    [`"I'm not."`, `"It's a funny picture. Of a dog."`],
    [`"Then why are you smiling?"`, `"Sure it is."`],
    [`puts the tablet face down on the table.`, `"No."`],
  ]},
  { id: 'night', label: 'the noise', need: (c) => c.phase === 'night', steps: [
    [`"Are you awake?"`, `"Did you hear that?"`],
    [`"No."`, `"Hear what?"`],
    [`"Something on the roof."`, `"Something in the wall. Scratching."`],
    [`"It's a bird."`, `"It's the pipes."`],
    [`"It's dark. Birds sleep."`, `"Pipes don't scratch."`],
    [`"Then it's the Wildblood and we'll be dead by morning. Go to sleep."`, `"Then it's a very small burglar. Go to sleep."`],
  ]},
  { id: 'morning', label: 'the coffee', need: (c) => c.phase === 'dawn' || c.phase === 'morning', steps: [
    [`"Is there coffee?"`, `"Don't talk to me yet."`],
    [`"There's {drink}."`, `"I wasn't going to."`],
    [`"That's not coffee."`, `"You just did, though."`],
    [`"It's hot and it's brown."`, `"Shh."`],
    [`drinks it anyway.`, `nods, and hands over a cup.`],
  ]},
  // The witness: a stranger standing in their kitchen, talked about in front of them.
  { id: 'visitor', label: 'your friend', need: (c) => c.stranger, steps: [
    [`"Is that one of yours?"`, `"Did you let them in?"`, `"Who's that?"`],
    [`"I thought they were yours."`, `"No. I thought you did."`, `"I don't know. They were here when I looked up."`],
    [`"Should we say something?"`, `"They're just standing there."`],
    [`"Maybe they're from the council."`, `"Leave it. They might go away."`, `"Ask them if they want a drink."`],
    [`"You ask them."`, `"If they're from the council, I've never seen that boiler before."`, `"They're not having the last of the {drink}."`],
  ]},
  // Drunk. Starts hotter (see startHomeTalk), and goes one of two ways: a row or a declaration.
  { id: 'drunk-row', label: 'what you said', need: (c) => c.tipsy >= 2, steps: [
    [`"You know what your problem is?"`, `"Say it again. Go on, say it again."`],
    [`+"Here we go."`, `+"Say what?"`],
    [`+"You think you're better than everyone."`, `+"What you said. About my mum."`],
    { calm: [`-"I don't. I think I'm better than {neighbour}."`, `-"I said she was a good cook."`],
      hot: [`+"At least I can hold my drink."`, `+"I'll say it again, then. Slower."`] },
    { calm: [`-laughs, and has to hold on to the counter.`, `-"Oh. Fair. That's fair."`],
      hot: [`+"Get out of my kitchen. #grudge"`, `+"I'm going to bed. Don't follow me. #storm"`] },
  ]},
  { id: 'drunk-love', label: 'the speech', need: (c) => c.tipsy >= 1, steps: [
    [`"I love you, you know that? You're my best mate."`, `"Come here. No, come here. I need to tell you something."`],
    [`"You're drunk."`, `"What?"`],
    [`"I'm a bit drunk. I still mean it."`, `"You're a good person. The best person in this flat."`],
    [`"I know you do."`, `"I'm the only other person in this flat."`],
    [`-"Good. #make-up #joke:best mate"`, `-"Still counts. #make-up #joke:the best person in the flat"`],
  ]},
  { id: 'drunk-story', label: 'the story', need: (c) => c.tipsy >= 2, steps: [
    [`"Did I tell you about the goose?"`, `"Did I ever tell you about the time I nearly joined the Long Watch?"`],
    [`"Yes."`, `"Twice. Tonight."`],
    [`"So the goose..."`, `"So I'm stood there in the robe..."`],
    [`+"You've told me."`, `+"You've told me. You were wearing the robe last time too."`],
    { calm: [`"...and that's why I can't go in the park any more."`, `"...and that's why I'm not allowed in the tower."`],
      hot: [`+"I'm telling it. Let me tell it. #grudge"`, `+"Fine. I won't tell you anything. Ever. #grudge"`] },
  ]},
  // A pair with a grudge opens on it.
  { id: 'grudge', callback: 'grudge', steps: [
    [`"Are we still not talking about {grudge}?"`, `"I've been thinking about {grudge}."`],
    [`+"I'm not talking about it."`, `"Go on."`, `-"I'd rather we did. It's too quiet in here."`],
    [`"I'm sorry. I was tired."`, `+"I was right, though."`],
    { calm: [`-"All right. Me too. #make-up"`, `-"Let's forget it. #make-up"`],
      hot: [`+"You weren't. You never are. #storm"`, `+"Then we're still not talking about it. #grudge"`] },
  ]},
  // A pair with a joke brings it back.
  { id: 'joke', callback: 'joke', steps: [
    [`"Remember {joke}?"`, `says "{joke}" to nobody in particular.`],
    [`-laughs. "Don't. I'm still not over it."`, `-"Don't start."`],
    [`-"I'm going to tell everyone."`, `-grins.`],
    [`"I'll never forgive you."`, `"Every time. You do this every time."`],
  ]},
];

// Three-handers, when a flat has three in.
const THREE = [
  { id: 'vote', label: 'the vote', steps: [
    [`@a "Right. House meeting."`],
    [`@b "Oh, no."`],
    [`@c "What's this about?"`],
    [`@a "Somebody's been using my towel."`, `@a "Somebody keeps eating the bread and leaving the ends."`],
    [`@b "Wasn't me."`],
    [`@c "Wasn't me."`],
    [`@a "So it was nobody, then."`],
    [`@b looks at {c}.`, `@c looks at {b}.`],
  ]},
  { id: 'pick', label: 'the film', steps: [
    [`@a "What are we watching?"`],
    [`@b "Something with explosions."`],
    [`@c "Something sad."`],
    [`@a "There's one with a sad explosion."`],
    [`@b "Put that on, then."`, `@c "Fine."`],
  ]},
];

// ── Interruptions ────────────────────────────────────────────────────────────
// `line` plays as scenery; `react` is said by whoever spoke last's other half; `derail` swaps the topic.
const INTERRUPTS = [
  { line: `The pipes in the wall bang twice, loudly.`, react: [`"That's the pipes. It's fine."`, `"Every night."`] },
  { line: `Someone thumps on the wall from next door.`, react: [`"We're not even being loud!"`, `"Sorry!" they shout at the wall.`] },
  { line: `A voice through the wall shouts, "SOME OF US WORK IN THE MORNING."`, react: [`"So do we!"`, `lowers their voice to a whisper.`], derail: 'neighbour' },
  { line: `A delivery drone bumps into the window, hovers, and goes away.`, react: [`"Did you order something?"`, `"Not again."`] },
  { line: `The fridge shudders and goes quiet.`, react: [`"Don't do this to me now."`, `goes and gives the fridge a slap. It starts again.`] },
  { line: `The lights flicker and come back.`, react: [`"Did you pay the power?"`, `"Don't."`], derail: 'money' },
  { line: `A tablet on the side buzzes, and both of them look at it.`, react: [`"Not mine."`, `"Ignore it."`] },
  { line: `Somebody downstairs drops something heavy, then laughs.`, react: [`"What are they doing down there?"`, `"Every single night."`] },
  { line: `A pigeon lands on the windowsill and looks in at them.`, react: [`"Shoo."`, `"Don't look at it, it'll come in."`], derail: 'cat' },
  { line: `The smoke alarm chirps once.`, react: [`"It's the battery."`, `"I'm not getting up for that."`] },
  { line: `A siren goes past outside and fades away.`, react: [`"Someone's having a worse night than us."`, `waits for it to pass.`] },
];

// ── Context ──────────────────────────────────────────────────────────────────
const WEATHER = { clear: 'this sun', cloudy: 'this grey', overcast: 'this gloom', rain: 'this rain', sleet: 'this sleet',
  thunderstorm: 'this storm', storm: 'this wind', snow: 'the snow', blizzard: 'this blizzard', fog: 'this fog', haze: 'the haze', ash: 'the ash' };
const dish = () => { const k = Object.keys(DISHES); return k.length ? DISHES[rand(k)].noun : 'soup'; };
const drink = () => { const k = Object.keys(DRINKS).filter((x) => DRINKS[x].hot); return k.length ? DRINKS[rand(k)].noun : 'tea'; };

function neighbourOf(zoneId, skip) {
  const pool = [];
  for (const n of world.npcs.values()) {
    if (n._dead || skip.has(n.id) || !n.home_zone || n.home_zone === zoneId || n.hostile) continue;
    pool.push(n);
    if (pool.length > 40) break;
  }
  return pool.length ? first(rand(pool)) : null;
}

async function contextFor(zoneId, folk) {
  const env = getEnvironmentState() || {};
  const ctx = {
    phase: env.timePhase, weather: WEATHER[env.weatherType] || null,
    dish: dish(), drink: drink(), neighbour: neighbourOf(zoneId, new Set(folk.map((n) => n.id))),
    stranger: getZonePlayers(zoneId).some((p) => !belongsHere(p, folk[0], zoneId)),
    tipsy: Math.max(...folk.slice(0, 2).map((n) => tipsyOf(n))),
  };
  try {
    const tv = await dispatchAction({ type: 'broadcast.getZoneNowPlaying', params: { zoneId } });
    if (tv?.program) ctx.tv = tv.program;
  } catch { /* no broadcast plugin */ }
  try {
    const res = await dispatchAction({ type: 'sportsleague.getStandings' });
    const rows = Array.isArray(res?.rows) ? res.rows : [];
    if (rows.length) ctx.team = rand(rows).team;
  } catch { /* no league */ }
  return ctx;
}

// ── Building the talk ────────────────────────────────────────────────────────
const TAG_RE = /\s*#([a-z-]+)(?::([^#"]+))?/g;
const TOKEN_RE = /\{([a-z]+)\}/g;

// One line: who says it, the text with tokens filled, its temper move and its tags. Null if a token's empty.
function resolveLine(raw, speakerIdx, cast, ctx, mem) {
  let s = raw, who = speakerIdx;
  const pin = /^@([abc]) /.exec(s);
  if (pin) { who = 'abc'.indexOf(pin[1]); s = s.slice(pin[0].length); }
  if (!cast[who]) return null;
  let move = 0;
  if (s[0] === '+') { move = 1; s = s.slice(1); } else if (s[0] === '-') { move = -1; s = s.slice(1); }
  const tags = [];
  s = s.replace(TAG_RE, (_, t, v) => { tags.push([t, v?.trim()]); return ''; });
  const other = cast[(who + 1) % Math.min(cast.length, 2)] || cast[0];
  const vals = { ...ctx, me: first(cast[who]), you: first(other), a: first(cast[0]), b: first(cast[1]), c: first(cast[2]),
    grudge: mem.grudge, joke: mem.joke };
  let ok = true;
  s = s.replace(TOKEN_RE, (m, k) => { const v = vals[k]; if (v == null || v === false) { ok = false; return m; } return v; });
  if (!ok) return null;
  for (const t of tags) if (t[1]) t[1] = t[1].replace(TOKEN_RE, (m, k) => vals[k] ?? m);
  return { who, text: s.trim(), move, tags };
}

function pickTopic(cast, ctx, mem) {
  if (cast.length >= 3 && Math.random() < 0.5) return rand(THREE);
  if (Math.random() < CALLBACK_CHANCE) {
    const cb = TOPICS.filter((t) => t.callback && mem[t.callback]);
    if (cb.length) return rand(cb);
  }
  const ok = TOPICS.filter((t) => !t.callback && (!t.need || t.need(ctx)) && t.label !== mem.grudge);
  // a drunk pair gets a drunk topic more often the drunker they are
  if (ctx.tipsy >= 1 && Math.random() < 0.3 + 0.2 * ctx.tipsy) { const d = ok.filter((t) => t.id.startsWith('drunk')); if (d.length) return rand(d); }
  // the witness topic is the funniest thing in the file; when it applies, it usually wins
  if (ctx.stranger && Math.random() < 0.5) { const v = ok.find((t) => t.id === 'visitor'); if (v) return v; }
  return rand(ok);
}

// ── Running it ───────────────────────────────────────────────────────────────
const talking = new Map();   // zoneId → talk

function stillOk(zoneId, cast) {
  if (!getZonePlayers(zoneId).length || zoneIsDark(zoneId)) return false;
  const here = new Set(eligibleNpcs(zoneId).map((n) => n.id));
  return cast.every((n) => here.has(n.id));
}

/**
 * Start a talk between the residents in `folk` (two or more, already checked as home, off shift and
 * awake). `hooks.done()` is called once when it ends; `hooks.bathroom(npc)` sends one off to sulk.
 */
export async function startHomeTalk(zoneId, folk, hooks) {
  if (talking.has(zoneId) || folk.length < 2) return false;
  const cast = [...folk].sort(() => Math.random() - 0.5).slice(0, 3);
  const pair = cast.slice(0, 2);
  const mem = memoryOf(pair[0], pair[1]);
  const talk = { cast, mem, topic: null, step: 0, line: 0, lane: randInt(0, 5), timer: null, hooks, derails: 0 };
  talking.set(zoneId, talk);
  holdBanterZone(zoneId, 10 * 60_000);
  let ctx;
  try { ctx = await contextFor(zoneId, cast); } catch { ctx = {}; }
  talk.ctx = ctx;
  // two or more drinks in, everything starts a notch hotter; somebody already angry walks in hot too
  talk.heat = (ctx.tipsy >= 2 ? 1 : 0) + (pair.some((n) => ['angry', 'annoyed'].includes(npcMoodOf(n)?.m)) ? 1 : 0);
  if (!stillOk(zoneId, cast)) return end(zoneId);
  talk.topic = pickTopic(cast, ctx, mem);
  if (!talk.topic) return end(zoneId);
  mem.talks++;
  emit('npc.banter.start', { zoneId, participants: pair.map((n) => n.id) });
  next(zoneId);
  return true;
}

function end(zoneId) {
  const t = talking.get(zoneId);
  if (!t) return false;
  clearTimeout(t.timer);
  talking.delete(zoneId);
  t.mem.at = Date.now();
  // the temper cools off between talks, but not all the way
  t.mem.temper = Math.max(0, Math.min(3, Math.round(t.mem.temper * 0.5)));
  emit('npc.banter.end', { zoneId, participants: t.cast.slice(0, 2).map((n) => n.id) });
  // how it went, for the Room Stage (plugins/roomstage npc-life.js afterTalk): a hug, a high five, a turned back
  if (t.topic && t.cast[1]) emit('npc.talk.after', { zoneId, a: t.cast[0].id, b: t.cast[1].id, outcome: t.outcome || (t.mem.temper + (t.heat || 0) >= 2 ? 'row' : 'calm'), tipsy: t.ctx?.tipsy || 0 });
  t.hooks?.done?.();
  return false;
}

function say(zoneId, npc, text) {
  sendToZone(zoneId, formatChitchat(npc.name, text));
  if (npc._ai) npc._ai.lastSay = Date.now();
}

function next(zoneId) {
  const t = talking.get(zoneId);
  if (!t) return;
  const { cast, mem, ctx } = t;
  const steps = t.topic.steps;
  if (t.step >= steps.length || t.line >= MAX_LINES || !stillOk(zoneId, cast)) return end(zoneId);

  // Something happens in the flat. It plays, the other one reacts, and maybe the talk goes elsewhere.
  if (t.line > 0 && Math.random() < INTERRUPT_CHANCE) {
    const it = rand(INTERRUPTS);
    sendToZone(zoneId, { type: 'ambient', message: `<span class="msg-ambient">${it.line}</span>`, flavour: true });
    const reactor = cast[t.step % 2] || cast[0];
    t.timer = setTimeout(() => {
      if (!stillOk(zoneId, cast)) return end(zoneId);
      say(zoneId, reactor, rand(it.react));
      const swap = it.derail && t.derails < 1 && TOPICS.find((x) => x.id === it.derail && (!x.need || x.need(ctx)));
      if (swap && swap !== t.topic && Math.random() < 0.6) { t.topic = swap; t.step = 0; t.lane = randInt(0, 5); t.derails++; }
      t.line++;
      t.timer = setTimeout(() => next(zoneId), randInt(TURN_GAP_MS[0], TURN_GAP_MS[1]));
    }, randInt(2500, 4500));
    return;
  }

  let step = steps[t.step];
  if (!Array.isArray(step)) step = mem.temper + (t.heat || 0) >= 2 ? step.hot : step.calm;
  const speakerIdx = t.step % 2;
  // the talk's lane first, so a thread follows on from itself; the others only if its tokens are empty
  const lane = step[t.lane % step.length];
  const options = [lane, ...step.filter((x) => x !== lane).sort(() => Math.random() - 0.5)];
  let line = null;
  for (const raw of options) { line = resolveLine(raw, speakerIdx, cast, ctx, mem); if (line) break; }
  t.step++;
  if (!line) { t.timer = setTimeout(() => next(zoneId), 500); return; }

  const speaker = cast[line.who], listener = cast[line.who === 0 ? 1 : 0];
  say(zoneId, speaker, line.text);
  t.line++;
  mem.temper = Math.max(0, mem.temper + line.move);
  // the face and the body go with the words: a mood on each, and a tone the Room Stage turns into a gesture
  const tone = toneOf(line, mem.temper + (t.heat || 0), ctx.tipsy);
  feel(speaker, listener, tone, ctx.tipsy);
  emit('npc.talk.line', { zoneId, speaker: speaker.id, listener: listener?.id, tone });
  if (line.tags.some(([k]) => k === 'make-up')) t.outcome = 'made-up';
  else if (line.tags.some(([k]) => k === 'grudge' || k === 'storm')) t.outcome = 'row';
  else if (line.tags.some(([k]) => k === 'joke') && t.outcome !== 'row') t.outcome = 'joke';

  for (const [tag, val] of line.tags) {
    if (tag === 'grudge') { mem.grudge = t.topic.label || mem.grudge; mem.temper = Math.max(mem.temper, 2); }
    else if (tag === 'make-up') { mem.grudge = null; mem.temper = 0; }
    else if (tag === 'joke' && val) mem.joke = val;
    else if (tag === 'storm') {
      mem.temper = Math.max(mem.temper, 3);
      const stormer = speaker;
      t.timer = setTimeout(() => { end(zoneId); t.hooks?.bathroom?.(stormer); }, randInt(2000, 3500));
      return;
    }
  }
  t.timer = setTimeout(() => next(zoneId), randInt(TURN_GAP_MS[0], TURN_GAP_MS[1]));
}

export const isTalking = (zoneId) => talking.has(zoneId);

// ── Tone: one word for how a line is said, read by the face (setNpcMood) and the body (npc-life.js TALK_CLIPS) ──
function toneOf(line, temper, tipsy) {
  const tx = line.text.toLowerCase(), tags = line.tags.map(([k]) => k);
  if (tags.includes('storm')) return 'storm';
  if (/\blaughs\b|\bgrins\b|^laugh/.test(tx)) return 'laugh';
  if (tags.includes('make-up') || (line.move < 0 && temper < 2)) return 'warm';
  if (line.move > 0 || tags.includes('grudge')) return temper >= 2 || tipsy >= 2 ? 'hot' : 'cross';
  if (/\bsighs\b/.test(tx)) return 'sigh';
  if (/^shrugs|^"(fine|whatever|maybe)/.test(tx)) return 'shrug';
  if (/^".*\?"$/.test(line.text)) return 'ask';
  return 'talk';
}
// The face for each tone: the speaker's, and how it lands on the other one.
const FACE = { laugh: ['amused', 'amused'], warm: ['happy', 'happy'], hot: ['angry', 'annoyed'], cross: ['annoyed', 'annoyed'],
  storm: ['angry', 'sad'], sigh: ['tired', null], shrug: ['confused', null], ask: ['confused', null], talk: [null, null] };
function feel(speaker, listener, tone, tipsy) {
  const [me, them] = FACE[tone] || [];
  const drunk = tipsy >= 2 && (tone === 'talk' || tone === 'ask') ? 'drunk' : null;
  const mine = me || drunk;
  if (mine) setNpcMood(speaker, mine, { i: tone === 'hot' || tone === 'storm' ? 0.9 : 0.6, secs: tone === 'storm' ? 300 : 45, force: true });
  if (them && listener) setNpcMood(listener, them, { i: 0.6, secs: tone === 'storm' ? 300 : 40, force: true });
}

// Test seam.
export const _talk = { TOPICS, THREE, INTERRUPTS, resolveLine, pickTopic, memoryOf, pairs, talking, end, toneOf };

// For npc-life.js: how sore a pair is right now (0 to 3), and a nudge when something they did together went
// one way or the other (an argument, a hug).
export function pairTemper(a, b) { const m = pairs.get(pairKey(a, b)); return m ? m.temper : 0; }
export function nudgePair(a, b, by) {
  const m = memoryOf(a, b);
  m.temper = Math.max(0, Math.min(3, m.temper + by));
  if (by < 0 && m.temper === 0) m.grudge = null;
  m.at = Date.now();
}
