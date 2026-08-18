// The people of TERMINUS, the things in their rooms, and the way in.
//
//   node scripts/build-terminus-npcs.mjs && npm run content:import
//
// Re-runnable: it overwrites its own output and nothing else. Run it AFTER build-terminus.mjs,
// which makes the rooms these people stand in.
//
// ── The rule everything below is written under ───────────────────────────────
//
//   THE TERROR IS AT THE WALL. THE INSIDE IS DOMESTIC, AND NOTHING EVER REMARKS ON IT.
//
// Outside the gate you are turned away, politely, forever, by people who will not tell you what is
// behind them. Inside, it is a kitchen, a laundry, a sick room and a school. Both halves are true
// at once and neither is a trick. A hostile cult is easy to leave; these people are warm, patient,
// pleased you came, and will not tell you a single thing you want to know, and see no contradiction
// in any of that.
//
// FOUR INSTRUMENTS, used everywhere, named nowhere:
//   1. Somebody answers before they were asked, and does not notice they did.
//   2. A great many people do one thing at one moment, with no signal for it.
//   3. Objects are in an order nobody was near enough to have put them in.
//   4. A room goes quiet in a way that has nothing to do with sound.
//
// THE ONE LINE NEVER TO WRITE is any line where a character explains the creed to the player. Ivo
// Stannard is the only one who talks plainly about this place, and he can do that because he
// touched the machine and is not going with them. Nobody else may.
//
// ── The names ────────────────────────────────────────────────────────────────
//
// People BORN inside carry virtue names: Verity, Thankful, Silence, Comfort, Mercy, Constant,
// Amity, Patience, Increase, Remember, Preserved, Hopestill. People who CAME carry ordinary ones:
// Ivo, Tace, Josiah. Nothing in the game ever says so, no NPC remarks on it, and no quest rewards
// working it out. It is there to be noticed on a second visit or never.
//
// All checked against the 215 existing NPCs for the unique-name rule (full name AND given name).
// NO EM DASHES in any Exodus line: that punctuation belongs to the Ascendants and the Architect.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const EXODUS = 'ideology_exodus';

function canonical(obj) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(obj), null, 2) + '\n';
}
const write = (dir, id, obj) => {
  const d = join(ROOT, 'content', dir);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `${id}.json`), canonical(obj), 'utf8');
};
const readJson = (dir, id) => {
  try { return JSON.parse(readFileSync(join(ROOT, 'content', dir, `${id}.json`), 'utf8')); }
  catch { return null; }
};

// An NPC row with every column the importer wants, so a definition below only states what is
// actually about that person.
const npc = (o) => ({
  banter: [], behaviour_graph: {}, chitchat: [], faction: EXODUS,
  home_activities: [], hp: 26, hp_max: 26, npc_type: 'npc',
  studio_zone_id: null, vendor_inventory: [], vendor_restock_rate: 1,
  vendor_schedule: {}, vendor_shop_name: null, vendor_stock_size: 10,
  wander_zones: [], wanders: 0,
  ...o,
  work_zone_id: o.work_zone_id ?? o.home_zone,
});
const node = (text, options = [], actions = []) => ({ actions, options, text });
const opt = (label, next, { actions = [], conditions = [] } = {}) =>
  ({ actions, conditions, enabled: true, label, next });

// ── Flags the way in turns on ────────────────────────────────────────────────
const Q1 = 'terminus_q1_done';        // Ivo's errand: you carried a thing and did not open it
const Q2 = 'terminus_q2_done';        // Tace's walk: you went all the way round
const ADMITTED = 'terminus_admitted'; // the child said you could come in

// ═════════════════════════════════════════════════════════════════════════════
// OUTSIDE THE WALL
// ═════════════════════════════════════════════════════════════════════════════

// THE PICKET. She stands a long way out on the road, which is the whole design of her: you are
// turned back before you are anywhere near the thing you came to see. She never says what is
// inside. She says you do not belong here, in about nine different ways, none of them unkind.
const TACE = npc({
  id: 'npc_terminus_picket', name: 'Tace Ambler', sex: 'female',
  home_zone: 'zone_terminus_1207_940',
  description: 'She has set a folding stool in the middle of the road and is sitting on it with her hands on her knees, facing west, which is to say facing you and facing the whole of the rest of the world at the same time. No weapon. No badge. A water bottle, a hat, and an entirely settled expression.\n\nShe stands up as you come, and it is not a challenge, it is manners.',
  flags: {
    clothing_layers: ['a wide canvas hat, re-brimmed twice', 'a grey shirt washed pale', 'boots with the soles stitched back on'],
    personality: 'stoic',
  },
  chitchat: [
    'This is as far as the road goes for you.',
    'You can sit if you like. I have got the stool but the rock is fine.',
    'I am not going to tell you and you are not going to guess.',
    'It is a long way back. Drink something before you start.',
    'No. Sorry. Genuinely, sorry, and still no.',
    'People do get in. Not many, and never the ones who ask.',
  ],
  dialogue_tree: {
    root: {
      actions: [],
      first: '"Morning." She says it before you are quite in earshot, which you decide not to think about. "You have come a long way, so I will be quick and I will be honest with you. You do not belong here, and I am not going to explain that, and I am not going to move."',
      options: [
        opt('What is in there?', 'inside'),
        opt('Who are you protecting it from?', 'from'),
        opt('Then what am I allowed to do?', 'allowed'),
        opt('Is there anything I can do for you?', 'work', { conditions: [{ flag: Q1, op: 'set' }, { flag: Q2, op: 'unset' }] }),
        opt('Nothing.', 'bye'),
      ],
      text: '"Still no."',
      text_by_relation: {
        close: '"You again." She moves the stool six inches so there is room to stand out of the sun. "Still no. You know that. Sit down anyway."',
        familiar: '"You." She nods at the rock beside the stool. "Still no."',
        known: '"Back again." She does not sound surprised, or bothered. "Still no."',
      },
    },
    inside: node(
      '"People."\n\nShe lets that sit for exactly as long as it takes you to decide it is a joke, and then says, "That was not me being clever. That is the answer. There are people in there, and they are doing what people do, and none of it is any of your business."\n\n"I know what you have decided it is. Everyone decides. You will be wrong in a way I would find quite funny, and I am still not going to tell you."',
      [opt('Who are you protecting it from?', 'from'), opt('Then what am I allowed to do?', 'allowed'), opt('Right.', 'bye')],
    ),
    from: node(
      'She thinks about that one, which she has not done with any of the others.\n\n"Nobody, mostly. Nobody comes. Twice a season somebody like you comes, and once a year somebody comes with a truck and a proposal." A pause. "The wall is not for keeping people out. It is for making the question be asked at the gate instead of in the middle of the yard."\n\n"You are asking it at the gate. That is the wall working."',
      [opt('What is in there?', 'inside'), opt('Then what am I allowed to do?', 'allowed'), opt('Right.', 'bye')],
    ),
    allowed: node(
      '"Everything except through. Trade with Stannard, he is straight and he will not cheat you. Fuel up. Sleep on the flats, nobody will touch you. Walk the whole wall if you want, and people do, and I have never once minded."\n\n"And then go home, or do not. That part is yours."',
      [
        opt('Is there anything I can do for you?', 'work', { conditions: [{ flag: Q1, op: 'set' }, { flag: Q2, op: 'unset' }] }),
        opt('Right.', 'bye'),
      ],
    ),
    // The second errand, and it only appears once Ivo's is done. She does not offer it to
    // strangers, because she does not have anything for strangers to do.
    work: node(
      'She looks at you for a while.\n\n"Stannard says you took his box to the gate and brought the empty back and did not open it. He tells me that about one person in nine."\n\nShe stands, and stretches, and points north with her chin.\n\n"Walk the wall. All of it, the whole way round, the north corner and the far side and the south, and come back here. It is about two hours and there is nothing to see and I am not going to pretend otherwise."\n\n"Do not ask me what it is for. I would only say something I would have to be embarrassed about later."',
      [opt('All right.', 'work_take', { actions: [{ action: 'START_QUEST', quest_id: 'quest_terminus_2' }] }), opt('No.', 'bye')],
    ),
    work_take: node(
      '"Good. Keep the wall on your right the whole way and you cannot get it wrong."\n\nShe sits back down and faces west again, at the world.',
      [opt('Right.', 'bye')],
    ),
    work_done: node(
      '"You did the whole thing." It is not a question. "Most people cut the north corner. There is a scree slope and it is genuinely horrible and everybody cuts it."\n\nShe looks at your boots, and then at you, and something in her settles.\n\n"All right. That is that done. Go and stand at the gate a while."\n\n"No, I am not telling you why."',
      [opt('Right.', 'bye')],
      [{ action: 'TURN_IN', quest_id: 'quest_terminus_2' },
       { action: 'ADJUST_REPUTATION', delta: 60, ideology_id: EXODUS, reason: 'The Long Way Round' }],
    ),
    bye: node('"Safe road."\n\nShe means it, and sits back down, and faces west.'),
  },
});
// The turn-in has to be reachable, and it is a separate option so a player who is mid-walk is not
// offered it. Conditions on a quest state would be better; the flag the quest sets is what exists.
TACE.dialogue_tree.root.options.splice(3, 0,
  opt('I walked the wall.', 'work_done', { conditions: [{ flag: Q2, op: 'set' }] }));

// THE SECOND GUARD. Blunter, younger, and much worse at it, which is the point: Tace has been
// doing this for thirty years and he has been doing it for two. He is the one who nearly tells you
// something, twice, and stops himself both times.
const JOSIAH = npc({
  id: 'npc_terminus_guard', name: 'Josiah Bly', sex: 'male',
  home_zone: 'zone_terminus_1209_941',
  description: 'A big young man standing where the road shoulder gives out, holding a long-handled shovel he is not using for anything. He watches you the entire way in, and when you get close he looks at your hands, and then at your face, and then decidedly at the horizon.\n\nHe has clearly been told what to say. You can see him going and getting it.',
  flags: {
    clothing_layers: ['a shapeless coat, too warm for this', 'a shirt somebody else grew out of', 'good boots, new'],
    personality: 'guard',
  },
  chitchat: [
    'You cannot be here. Well. You can be there. Not here.',
    'I am not meant to talk to you much.',
    'Ambler does the talking. I do the standing.',
    'It is nothing personal. It is really genuinely nothing personal.',
    'Do not go round the back. There is nothing round the back. Just do not.',
  ],
  dialogue_tree: {
    root: {
      actions: [],
      first: '"You cannot come in." He gets it out fast, the way you say a thing you have practised. "That is, ah. That is all of it, really. That is the whole of what I have got."',
      options: [
        opt('What is it like in there?', 'like'),
        opt('You do not seem to enjoy this.', 'enjoy'),
        opt('All right.', 'bye'),
      ],
      text: '"Still cannot come in."',
      text_by_relation: {
        close: '"Oh. It is you." He relaxes about four inches and then remembers and puts them back. "Still cannot come in. Sorry."',
        familiar: '"You." He nods, once, too much. "Still cannot come in."',
        known: '"Right. Yes. Still no."',
      },
    },
    like: node(
      '"It is good," he says, and then his face does something complicated, "no, I am not, I am not meant to say what it is like, I am meant to say that you do not belong here."\n\nA pause.\n\n"You do not belong here."\n\nHe looks unhappy about having said the first bit and unhappier about the second, and does not take either of them back.',
      [opt('You do not seem to enjoy this.', 'enjoy'), opt('All right.', 'bye')],
    ),
    enjoy: node(
      '"No." He turns the shovel over in his hands. "I am not good at it. Ambler is good at it. She can say no to somebody and they go away feeling like they were given something."\n\n"I came here myself, you know. Off the road. Fourteen years old with nothing." He stops dead, hearing himself. "And that is also not something I am meant to say, so."\n\nHe puts the shovel down, blade first, and stands on the shoulder of the road looking at the salt in the south, and does not say anything else for a while.',
      [opt('All right.', 'bye')],
    ),
    bye: node('"Right. Yes. Safe road."\n\nHe says it a beat after you have already turned away, to your back, and means it.'),
  },
});

// THE CHILD AT THE GATE, and the whole design of the way in.
//
// She is the payoff for Verity Strand's own line, which was written in pass 1 and which the
// admission had to honour: "Go and live. Do the work you'd have done anyway. Someone will notice,
// and it will not be me, and you'll be told." So it is not the warden who lets you in and it is
// not a quest board. A nine year old walks out of a wall that has no way through it, knows what you
// have been doing, and tells you to come in.
//
// Nothing ever explains how she got out. Nobody remarks on it. She is the sharpest instrument in
// the district and this is one of the two places she is used.
const HOPESTILL = npc({
  id: 'npc_terminus_child', name: 'Hopestill', sex: 'female', hp: 12, hp_max: 12,
  home_zone: 'zone_terminus_1210_940',
  description: 'A girl of about nine, sitting on a rock at the side of the road with her heels drawn up, entirely absorbed in nothing at all. She is on the wrong side of a wall with no way through it and does not appear to think this is worth mentioning.\n\nWhen you look at her she is already looking back, and she waits, comfortably, for you to work out what you were going to say.',
  flags: {
    clothing_layers: ['a smock cut down from something adult', 'a cardigan with the elbows gone', 'sandals, mended'],
    personality: 'quiet',
  },
  chitchat: [
    'Hello.',
    'I am not supposed to be out here. It is fine.',
    'You have got a lot of things. Are they all yours?',
    'That one over there is Josiah. He is nice. He worries.',
    'It is going to be windy later.',
  ],
  dialogue_tree: {
    root: {
      actions: [],
      first: '"Hello." She says it pleasantly, and then, before you have said anything, "You are the one with the truck."',
      options: [
        opt('How did you get out here?', 'out'),
        opt('What is your name?', 'name'),
        opt('Somebody said I should stand at the gate.', 'told',
          { conditions: [{ flag: Q1, op: 'set' }, { flag: Q2, op: 'set' }, { flag: ADMITTED, op: 'unset' }] }),
        opt('Nothing.', 'bye'),
      ],
      text: '"Hello again."',
      text_by_relation: {
        close: '"There you are." She budges up on the rock, which is not big enough for two people and she does it anyway.',
        familiar: '"Hello." She has been expecting you, in the way a child expects the afternoon.',
        known: '"You came back." She sounds pleased and not at all surprised.',
      },
    },
    out: node(
      '"I walked."\n\nShe says it the way you would say it, if you had walked.\n\n"Do you want to see how far I can throw a stone? It is quite far. It is further than Josiah, but he lets me, so it does not count."',
      [opt('What is your name?', 'name'), opt('Nothing.', 'bye')],
    ),
    name: node(
      '"Hopestill."\n\nShe waits. Then, kindly, because you have not managed it, she says your name back to you, and gets it right, and goes back to looking at the road.',
      [opt('How did you get out here?', 'out'), opt('Nothing.', 'bye')],
    ),
    // THE DOOR. It is a question, and answering it one particular way is the only commitment
    // anywhere in this chain: it moves the player's stance and their path, on the ordinary
    // ideology axes, through the ordinary actions. There is no Terminus-only membership number
    // and no secret society flag doing the real work behind them.
    told: node(
      '"That was Ambler." She sounds satisfied about it. "She always says that. She thinks it is very subtle."\n\nShe gets down off the rock and stands in front of you, and she is small, and it makes no difference at all to the shape of the conversation.\n\n"I have to ask you a thing and then I am allowed to take you in. It is only one thing and there is no wrong answer, there are just different answers." A breath. "What are you for?"',
      [
        // The Exodus answer. Not phrased as a creed and not phrased as a vow, because a vow would
        // be the game explaining itself: it is a plain sentence a person might actually say.
        opt('I have not found out yet. I would like to.', 'in', {
          actions: [
            { action: 'ADJUST_PATH', delta: 45, path: 'mind' },
            { action: 'ADJUST_STANCE', delta: -25 },
            { action: 'ADJUST_REPUTATION', delta: 80, ideology_id: EXODUS, reason: 'The Standing' },
            { action: 'SET_FLAG', flag: ADMITTED, scope: 'player', value: 'yes' },
          ],
        }),
        opt('Getting paid.', 'other'),
        opt('That is not a question anybody can answer.', 'other'),
      ],
    ),
    in: node(
      'She nods, once, as though you have confirmed the weather.\n\n"All right."\n\nAnd she turns and walks at the gate, and does not slow down, and the two leaves of it come apart in front of her without a sound and without anybody behind them, and she goes through without looking back to see whether you are following.\n\nFrom inside, without turning round: "You can come in. You will walk into some doors. Everybody does."',
      [opt('Follow her.', 'bye')],
    ),
    other: node(
      '"All right."\n\nShe does not look disappointed, or interested, or anything much. She gets back on the rock and draws her heels up and goes back to watching the road.\n\n"You can ask me again another day. I will still be here. I am always here."',
      [opt('Right.', 'bye')],
    ),
    bye: node('"Bye."\n\nShe waves, and goes on sitting on the rock, on the wrong side of the wall.'),
  },
});

// ═════════════════════════════════════════════════════════════════════════════
// INSIDE THE WALL
// ═════════════════════════════════════════════════════════════════════════════

const INSIDE = [
  // THE ELDER. Warm, delighted you came, and will not tell you one useful thing. She is the
  // horror-of-kindness beat carried by a single person: there is nothing to push against.
  {
    id: 'npc_exo_elder', name: 'Thankful Sedge', sex: 'female', zone: 'zone_exo_waking',
    personality: 'charity',
    clothing: ['a plain coat, grey, unmarked', 'a high-necked shirt', 'shoes kept for indoors'],
    desc: 'An old woman sitting on the end of a bench near the worn patch of floor, not at the front and not facing anywhere in particular. She is mending a sleeve. She is extremely pleased to see you and makes no attempt to hide it, and at no point does she ask you a single question about yourself.',
    chitchat: [
      'You found us. Well done.',
      'Sit down. There is nothing on.',
      'No, I will not, and you are very good to keep asking.',
      'It is not a secret. It is just not a sentence.',
      'You will get it, or you will not, and either is all right.',
    ],
    first: '"Oh, good." She puts the sleeve down. "I did wonder how long. Sit, sit. Nobody is doing anything."',
    text: '"Sit down, if you like."',
    byRel: {
      known: '"You are still here." She sounds delighted about it.',
      familiar: '"There you are." She makes room she did not need to make.',
      close: '"Ah." She does not look up from the sleeve, and moves along the bench, and carries on.',
    },
    nodes: {
      what: ['What is this place?',
        '"It is where we live."\n\nShe waits, quite comfortably, to see whether you will accept that. When you do not, she smiles at the sleeve.\n\n"You want me to say a bigger word. I have got one. Everybody in here has got one. The trouble with the bigger word is that once I say it, that is what you will have come here and found, and you will stop looking, and what you found will be a word."\n\n"So. It is where we live. Ask me again in a year."'],
      leave: ['Where are you all going?',
        '"Out."\n\nShe threads the needle, which at her age takes a moment and which she does not hurry.\n\n"That is not me being difficult either. We do not say the place. Not to you, not to Stannard, not much to each other. The machine kept every record there has ever been and the one place it never reached was the inside of a head, and a thing that is said out loud stops being in there."\n\n"So we are going out. And we are taking a very long time over it, and we are getting it right."'],
      hall: ['What happens in this room?',
        '"People sit in it."\n\nA pause you could drive a truck through.\n\n"There is a bit at the end where somebody stands, if they have got something. Mostly nobody has. It is very restful. You are welcome to sit in it whenever you like."\n\nBehind her, at the far end of the hall, four people who have not spoken to each other get up at the same moment and go out by different doors. She does not turn round.'],
      me: ['What am I supposed to do here?',
        '"Whatever you would have done anyway."\n\nShe holds the sleeve up to the light, decides against it, and starts again.\n\n"Eat with everybody. Wash up your own bowl. If somebody is carrying something heavy, take an end. If a door does not open for you, do not stand there arguing with it, there is nobody to argue with."\n\n"And do not tell anybody in here what you used to be. Not because we would mind. Because you will want to, badly, for about a fortnight, and then one morning you will not, and that morning is worth having."'],
    },
  },
  // THE STILLHOUSE. He operates the machine that takes everything out of you and he is completely
  // matter-of-fact about it, which is worse than solemnity would be.
  {
    id: 'npc_exo_stillhouse', name: 'Silence Marrable', sex: 'male', zone: 'zone_exo_stillhouse',
    personality: 'stoic',
    clothing: ['a rubber apron, cracked and clean', 'sleeves rolled to the elbow', 'clogs'],
    desc: 'A wiry man in a rubber apron, folding linen, with the unbothered competence of somebody who has done a difficult thing several hundred times. His forearms are scarred in a pattern that is not from work.\n\nHe glances at you once, at your arms and your jaw and the way you stand, and prices you in about a second and a half.',
    chitchat: [
      'Sit when you are ready. Not before.',
      'It is not quick and it is not clean and it does work.',
      'Everybody asks whether it hurts. Yes.',
      'The drum goes out on a Thursday.',
      'You keep your name. That is the one thing you keep.',
    ],
    first: '"You are the new one." He puts the linen down. "Nothing today. Look at the room. Come back when you have stopped looking at the chair."',
    text: '"Not today."',
    byRel: {
      known: '"Back." He nods at the bench. "Sit down if you are sitting."',
      familiar: '"You." He carries on folding. "Still not today?"',
      close: '"Ah." He puts the kettle on without being asked, which from him is an embrace.',
    },
    nodes: {
      chair: ['What does the chair do?',
        '"Takes it out."\n\nHe says it exactly as flatly as that, and then, because he is fair, gives you the whole of it.\n\n"Wire, plate, weave, whatever you are carrying. Anything grown into you that was not yours to start with. All of it, in one go, and it goes in the drum, and the drum goes out on a Thursday and is not discussed."\n\n"It hurts. I am not going to dress that up. You will be on the floor for a while and somebody will sit with you. And I will tell you twice before I do it, and if you sit down and change your mind, you get up. That has happened. Nobody said anything about it then either."'],
      why: ['Why does it have to come out?',
        'He considers you for a moment.\n\n"Because you cannot carry two answers."\n\nAnd that is the entire explanation, and he goes back to the linen, and it is very clear that as far as he is concerned the subject has been fully covered.'],
      door: ['What is behind the far door?',
        '"A room."\n\nHe does not look at it.\n\n"There is no handle on it because it does not need one. It will not open for you. It will not open for most people, for a long while, and standing in front of it does nothing at all except make you late."\n\nHe folds the last of the linen and squares the pile off.\n\n"It opened for me when I was thirty-one. I had been here since I was six."'],
    },
  },
  // THE COOK. A vendor, and the warmest thing in the compound. She is where the district's whole
  // argument gets made: forty feet of table and nobody at the head of it.
  {
    id: 'npc_exo_cook', name: 'Comfort Delaide', sex: 'female', zone: 'zone_exo_table',
    personality: 'vendor', shop: 'The Long Table',
    clothing: ['an apron, boiled white, scorched at one hip', 'sleeves pinned back', 'clogs with the heels gone over'],
    desc: 'A broad woman working three pots with one spoon, tasting from the back of her hand, entirely in charge of a room that does not have anybody in charge of it. She has flour to the elbow and has clearly been up since four.\n\nShe puts a bowl in front of you before you have said anything, and does not appear to notice doing it.',
    chitchat: [
      'Eat that. You can talk after.',
      'Barley. It is always barley. It is very good barley.',
      'Wash your own bowl. Everybody does. Yes, everybody.',
      'There is no charge for the pot. The rest of it, we will talk.',
      'You are too thin and I have said nothing.',
    ],
    first: '"Sit down." She points with the spoon at forty feet of empty bench. "Anywhere. There is no top end."',
    text: '"Sit down. Anywhere."',
    byRel: {
      known: '"You." A bowl arrives. "Sit."',
      familiar: '"There you are, I had it warm." A bowl arrives, and it was warm.',
      close: 'She has already got the bowl in her hand when you come through the door, and neither of you says anything about that.',
    },
    nodes: {
      food: ['Where does all this come from?',
        '"The glass, mostly. Beans, greens, the tomatoes when they are in. Barley we grow out on the flats in the wet years and buy in the dry ones, and buying it in is the thing nobody enjoys."\n\nShe tastes, and adds nothing.\n\n"Fish, once a season, from a man who drives four days to bring it and will not tell anybody where he gets it. He and I have a great deal in common and we have never once discussed it."'],
      table: ['Nobody is sitting at the head.',
        '"There is not one." She says it comfortably. "It is a long table. A long table has two ends and they are both the end."\n\nShe wipes the spoon.\n\n"You will want to know who is in charge. I will save you the fortnight: nobody is, and that is not a lovely idea somebody had, it is just how it has ended up, and it works about nine days in ten. On the tenth day it is horrible and we get through it."'],
    },
    stock: [
      ['item_flat_bread', 3], ['item_soup_bowl', 6], ['item_barley_water', 3],
      ['item_lamp_greens', 4], ['item_bean_sprout', 4], ['item_herb_bundle', 10],
      ['item_water_bottle', 4], ['item_tea_leaves_herbal', 8], ['item_seed_oil', 14],
      ['item_salt_ration', 2],
    ],
  },
  // THE PHYSICIAN. The whole of the compound's medicine is in one head, and she knows it, and it
  // is the only thing in the district anybody is frightened of.
  {
    id: 'npc_exo_physician', name: 'Mercy Vantry', sex: 'female', zone: 'zone_exo_mending',
    personality: 'doctor', shop: 'The Mending Room',
    clothing: ['a linen coat, boiled grey', 'a shirt with the cuffs cut off', 'plain shoes'],
    desc: 'A tall woman with her sleeves cut off at the elbow, writing in a book with the stub of a pencil. Every surface in the room has been scrubbed within an hour. She finishes the sentence before she looks up, and looks up at the part of you that is wrong before she looks at your face.',
    chitchat: [
      'Sit on the bed, not the table.',
      'Show me. Do not tell me, show me.',
      'It will scar. Everything scars. Scars are fine.',
      'I have got one of everything and two of nothing.',
      'If it is the teeth, I am sorry in advance.',
    ],
    first: '"Are you bleeding?" It is the first thing she says and it is not rhetorical. "No. Right. Then sit down and do not touch anything."',
    text: '"Are you bleeding?"',
    byRel: {
      known: '"You. Still upright." She goes back to the book.',
      familiar: '"Sit down. How is the thing." She does not say which thing and does not need to.',
      close: '"Ah." She puts the pencil down, which for her is dropping everything.',
    },
    nodes: {
      alone: ['Is it just you?',
        '"For everything, yes."\n\nShe closes the book.\n\n"Two hundred and eleven people. Babies, backs, burns, teeth, the ones that are going to die and the ones that only think they are. There is a girl of nineteen who is learning it and she is quick and she is four years off, and I am fifty-eight."\n\n"That is the only sum in this place that frightens anybody. Nobody talks about it. I am telling you because you are not from here, so it costs me nothing."'],
      chrome: ['You could fix a lot of that with better gear.',
        'She looks at you for slightly too long.\n\n"I could." A beat. "Do not say that at the table."\n\nAnd she opens the book again, and writes the sentence she was going to write, and does not say another word about it.'],
    },
    stock: [
      ['item_rag_bandage', 6], ['item_bandage', 14], ['item_field_splint', 30],
      ['item_medkit', 70], ['item_herb_bundle', 12], ['item_soap_block', 4],
      ['item_towel_rough', 10],
    ],
  },
  // THE WORKSHOP. A vendor of the plainest possible things, and the man who has spent his life on
  // the thing on the pad without once saying what it is.
  {
    id: 'npc_exo_smith', name: 'Constant Ferris', sex: 'male', zone: 'zone_exo_bench',
    personality: 'gruff', shop: 'The Bench',
    clothing: ['a leather apron, hard as board', 'a shirt burned through in eleven places', 'boots with steel in the toes'],
    desc: 'A heavy-shouldered man filing a face on a piece of stock, counting the strokes under his breath. He gets to eleven, turns the work, and starts again. There is a drawing on the wall behind him that has been corrected in three hands over twenty years, and he does not look at it, because he knows it.',
    chitchat: [
      'Eleven. Then turn it.',
      'Hand tools. You want a machine, there is a city for that.',
      'It will outlast you. That is the whole idea.',
      'Do not put that back in the wrong outline.',
      'Everything in here has been made twice.',
    ],
    first: '"Mind the swarf." He does not look up. "You can watch. Do not touch the board."',
    text: '"Mind the swarf."',
    byRel: {
      known: '"You." He turns the work. "Mind the swarf."',
      familiar: 'He grunts, which you have learned is a greeting, and pushes a stool out with his foot.',
      close: '"Take an end of this," he says, before you are through the door, and you do.',
    },
    nodes: {
      drawing: ['What is the drawing?',
        'He looks at it as though noticing it.\n\n"Work."\n\nHe files eleven strokes and turns the piece.\n\n"My mother put the middle third of that on the wall. Her hand is the small one. The top is her teacher and the corrections are mine and one day somebody will correct mine, and that will be a good day and I will not be here for it."\n\nHe blows the dust off the work and holds it up.\n\n"That is as much as you are getting and it is more than I meant to say."'],
      tools: ['Every tool is in its own outline.',
        '"Yes."\n\nHe considers whether that needs anything adding to it, and decides it does.\n\n"Because then you can see the one that is missing from the door, in the dark, in a second. It is not tidiness. Tidiness is what it looks like from outside."'],
    },
    stock: [
      ['item_pipe_wrench', 80], ['item_kitchen_knife', 35], ['item_rag_bandage', 6],
      ['item_soap_block', 3], ['item_towel_rough', 9], ['item_scrap_metal', 7],
      ['item_calib_rig_scrap', 130],
    ],
  },
  // THE SEED VAULT. Four hundred drawers, no lock, and a man who counts them.
  {
    id: 'npc_exo_seed', name: 'Preserved Wain', sex: 'male', zone: 'zone_exo_seed',
    personality: 'quiet',
    clothing: ['a wool coat worn indoors, always', 'fingerless gloves', 'soft shoes'],
    desc: 'A small precise man in a coat and fingerless gloves, working along a bank of drawers with a slate and a stub of chalk, counting under his breath in tens. He is very cold and does not appear to have thought about it in years.',
    chitchat: [
      'Shut it behind you. The cold is the point.',
      'Four hundred and six. It was four hundred and eleven.',
      'Do not breathe on an open drawer.',
      'Some of these have not been grown in ninety years.',
      'They are not ours. We are just where they are.',
    ],
    first: '"Shut the door." Then, having looked at you: "Thank you. Most people do not, first time."',
    text: '"Shut the door behind you."',
    byRel: {
      known: '"You shut it." He sounds pleased. "Good."',
      familiar: '"Come and hold this."',
      close: 'He hands you the slate without looking up, and carries on counting, and you find you are keeping the tally.',
    },
    nodes: {
      lock: ['There is no lock on the door.',
        '"No."\n\nHe writes a number, checks it, and writes it again.\n\n"If it needed one it would be the wrong place for it."'],
      taking: ['Are you taking all this with you?',
        'He stops.\n\nIt is the first time he has stopped.\n\n"Yes," he says, and there is a very long pause, and then he goes back to the drawers and says, in a completely ordinary voice, "That is what it is for. That is what it has always been for."\n\nSomewhere above you, out in the compound, a great many people stop doing something at the same moment.'],
    },
  },
  // THE CRECHE. The other place the child instrument is used, and it is used on eleven of them at
  // once and never explained.
  {
    id: 'npc_exo_creche', name: 'Amity Locke', sex: 'female', zone: 'zone_exo_creche',
    personality: 'charity',
    clothing: ['a smock with chalk down the front', 'a cardigan, much mended', 'flat shoes'],
    desc: 'A young woman sitting on a bench that is too low for her, surrounded by eleven children who are all drawing, and none of whom are talking, and none of whom seem to need to. She has chalk on her face and has not noticed.\n\nShe smiles at you and puts a finger to her lips, and the room is already silent.',
    chitchat: [
      'They are working. Sit if you like.',
      'That one is Hopestill. You have met her, I think.',
      'They are good. They are frighteningly good.',
      'No, I do not have to keep order. I never have.',
      'Mind the tin. The chalk is counted.',
    ],
    first: '"Oh, hello." She stands, and eleven heads do not come up. "You are the one from outside. Come in, they will not mind."',
    text: '"Come in. They will not mind."',
    byRel: {
      known: '"Back again." Eleven heads do not come up.',
      familiar: '"They asked whether you would come today," she says, and does not say who asked.',
      close: '"They have drawn you. Do not look, it is not finished."',
    },
    nodes: {
      quiet: ['It is very quiet in here.',
        '"They are working."\n\nShe says it as though that settles it, and for her it does.\n\n"They talk at supper. It is deafening. My ears go for an hour." She looks fondly round the room. "In here they have got something to do, so they do it."\n\nOne of them, without looking up, pushes the chalk tin six inches to the left, and about a second later a child on the other side of the room reaches out and takes a piece from it without looking either.'],
      drawing: ['What are they all drawing?',
        '"The same thing." She is amused about it. "They always do, for about a fortnight, and then it is something else for a fortnight."\n\nYou look. Eleven sheets of paper. Eleven versions of a shape with a great many straight lines going up out of it, and none of them can see each other\'s work from where they are sitting, and the lines are in the same order on all eleven.\n\n"It is a nice one, this one," she says. "Last month it was a horse."'],
    },
  },
  // THE REFUGE. This is the "part refuge" half of the district in one person, and the only place
  // anybody says out loud what the compound is for.
  {
    id: 'npc_exo_refuge', name: 'Patience Colm', sex: 'female', zone: 'zone_exo_opendoor',
    personality: 'charity',
    clothing: ['a heavy skirt, working weight', 'a shirt with the collar turned', 'shoes that have been resoled twice'],
    desc: 'A woman in her fifties making up a bed that is already made, because it has been empty three weeks and she does it anyway. There is a fire lit at the end of the hall for nobody, and a chair pulled up to it for nobody, and she has clearly had that fire going since long before you came up the road.',
    chitchat: [
      'There is a bed. There is always a bed.',
      'You do not have to say where you came from.',
      'First name in the book. That is all we want.',
      'The fire stays lit. Do not put it out for us.',
      'Some of them stay a night. Some of them stay thirty years.',
    ],
    first: '"Ah, good, somebody." She snaps the sheet flat. "Take a cell, any of them, and put a name in the book on the way out. First name. Nothing else."',
    text: '"There is a bed. There is always a bed."',
    byRel: {
      known: '"You are still with us." She sounds glad about it.',
      familiar: '"Your one is made up." It is. It has been all week.',
      close: 'She has moved the chair by the fire round to face the door, and does not say she has.',
    },
    nodes: {
      book: ['Why only a first name?',
        '"Because that is all anybody needs to be given a bed."\n\nShe smooths the sheet.\n\n"There are eleven people in this compound who came up that road with a surname they did not want any more. Two of them run things. One of them is my husband. If the book asked for the rest of it, none of the three would be here, and I would have been the reason."'],
      cost: ['What does it cost?',
        'She actually laughs.\n\n"Nothing. Sorry. That is a horrible answer to have to give somebody, I know, and everybody hates it for about a week."\n\nShe tucks the corner in.\n\n"You want to be told the price so you can decide whether you can afford it. There is not one. Eat at the table, wash your bowl, take an end if somebody is carrying something. That is the whole of it and it is not a trick and I am afraid you will not believe me for a while."'],
      out: ['What happens to the ones who leave?',
        '"They leave."\n\nShe straightens up and looks down the hall at the six open doors and the six made beds.\n\n"Most of them go back to it, you know. Six in ten. They get to about the fourth week and there is a morning where the quiet is unbearable and they walk out through the gate and Ambler wishes them a safe road." A pause. "And about one in nine of those comes back, some years later, and there is a bed."\n\n"I have made this one up every week for three years. He is called Tobin. He will get here."'],
    },
  },
  // THE PLANT. The one machine they keep, kept better than anything else, by a man who has to hold
  // both halves of that in his head every day and does it without comment.
  {
    id: 'npc_exo_engineer', name: 'Increase Talley', sex: 'male', zone: 'zone_exo_charge',
    personality: 'gruff',
    clothing: ['overalls, oil to the knee, washed weekly', 'a vest gone grey', 'boots'],
    desc: 'A man of about forty with a rag through his belt, standing with one hand flat on the generator housing, listening to it. He stays like that for a while. Then he takes his hand off, writes one line in the log, and only then notices you.',
    chitchat: [
      'It is running right. I would know.',
      'One line a day. Eleven years of them.',
      'Oil is the only thing we buy that I sign for myself.',
      'Do not touch the log with those hands.',
      'It will do another eleven if I do my job.',
    ],
    first: '"Mind the pad, it is greasy." He wipes his hands. "You are the new one. Everybody comes and looks at it eventually."',
    text: '"Mind the pad."',
    byRel: {
      known: '"You." He goes back to the gauge. "Mind the pad."',
      familiar: '"Listen to that," he says, of a sound you cannot hear, and you both listen to it.',
      close: 'He moves along the bench without being asked, and there is a mug on it that is not his.',
    },
    nodes: {
      one: ['You are not supposed to have one of these.',
        'He does not react at all, which takes practice.\n\n"It runs the lamps in the sick room and the pump on the cistern and the cold in the seed vault. And the pump out on the road, and the lights in Stannard\'s shed, which he would tell you about at length."\n\nHe checks the gauge. Writes nothing.\n\n"I keep it running and I keep the log and in eleven years nobody has come in here and had an argument with me about it. Not one person. You are the first one to bring it up and you do not live here."\n\nA beat.\n\n"That is not a complaint. Take it however you like."'],
      log: ['Eleven years of one line a day.',
        '"Twelve in March."\n\nHe turns a page back, and another, and finds a day without looking for it.\n\n"That one. Load dropped a third for six hours and I could not find why, and I stripped the governor twice, and on the third day I found a bird in the intake." He shuts the book. "I wrote that down too. That is the point of writing it down."'],
      after: ['What happens to it when you all go?',
        'He stops with his hand on the housing.\n\n"It stays."\n\nHe says it flatly, and then, because he is honest, "It has to. It is four tons and it is the wrong kind of thing to be taking." A pause. "Somebody will come up that road eventually and find a shed with a plant in it that starts first time, and a log, and no one at all."\n\nHe takes his hand off the machine.\n\n"I have thought about writing them a note. I probably will not."'],
    },
  },
  // THE BURIAL GROUND. Short, plain, and holding the district's one genuinely impossible detail,
  // which is never remarked on by her or by anybody.
  {
    id: 'npc_exo_burial', name: 'Remember Sett', sex: 'female', zone: 'zone_exo_quiet',
    personality: 'quiet',
    clothing: ['a dark coat, not black, just old', 'a shirt buttoned to the throat', 'boots'],
    desc: 'A woman folding linen beside a stone bier, doing it slowly, along creases that were made a long time ago. There is a candle lit on the lectern. There is a name on the bier.\n\nShe does not stop when you come in and she does not mind that you have.',
    chitchat: [
      'You can come in. She will not mind.',
      'Two dates. That is the whole of what we put.',
      'The candle is lit while there is somebody on the stone.',
      'It is cold in here on purpose.',
      'Everybody helps carry. Everybody.',
    ],
    first: '"Come in." She does not look up from the linen. "There is somebody here today, so mind your voice, that is all."',
    text: '"Come in."',
    byRel: {
      known: '"You." She nods at the bier. "Nobody today."',
      familiar: 'She hands you the other end of the sheet, and you fold it together, and neither of you says anything.',
      close: '"Sit with me a minute," she says, and you do, and that is the whole of it.',
    },
    nodes: {
      markers: ['Every marker is the same.',
        '"Yes."\n\nShe shakes out the sheet.\n\n"A name and two dates. There was an argument about it once, a long time before me, and whoever won it won it properly, because nobody has raised it since."\n\nShe folds.\n\n"You want to know which one is important. That is the argument, that is exactly the argument, and that is why they are all the same size."'],
      book: ['How far back does the book go?',
        '"To the first one we had paper for."\n\nShe turns the lectern book back, and back, to a first page in a small square hand, and turns it forward again to the last three entries, and they are in the same hand, and she closes the book without appearing to have seen anything worth mentioning.\n\n"There are people before that. They are out in the plot with the rest. We just did not have the paper."'],
    },
  },
];

// ── Furniture ────────────────────────────────────────────────────────────────
//
// Two kinds, and only one of them does anything mechanical.
//
// The MUNDANE half is the district's whole argument, so it is the bigger half: cots, a trough, a
// slate, a bier, four hundred drawers. A compound of shrines with a mystery in every room is a
// theme park; a compound that is mostly laundry, with one room you cannot get into, is a place.
//
// The PSIONIC half is exactly two objects, and both of them are real: the stillhouse chair carries
// `psi_purifier`, which plugins/psionics/purifier.js actually reads, and the stillwell is prose in
// a room whose DOOR is the mechanic. Nothing here invents a flag that nothing reads. That rule was
// bought the expensive way by the mutations system's `effects` keys, which were authored on every
// row and consumed by literally nothing for months.
const FURNITURE = [
  // The Stillhouse. The real chair, at last, in the room the Yards copy is named after.
  ['furn_exo_purifier_real', 'zone_exo_stillhouse', 'the stillhouse chair', 'machine',
   'A dentist\'s chair with the upholstery long gone, bolted through the floor over the drain, under a hood of salvaged medical gear and a great many cable ties. There is nothing written on this one. There are straps, and they are lined with sheepskin, and the sheepskin has been replaced recently.\n\nWhatever it takes out of people goes into the sealed drum outside the door, and the drum is nearly full.',
   { psi_purifier: true }],
  ['furn_exo_still_bench', 'zone_exo_stillhouse', 'a bench of folded linen', 'furniture',
   'A scrubbed bench with a great deal of clean linen folded on it and a bucket underneath. The folding is exact. There is a lot of linen for a room with one chair in it.', {}],
  ['furn_exo_stillwell', 'zone_exo_stillwell', 'the stillwell', 'furniture',
   'A basin four feet across, cut from one piece of stone and sunk flush into the floor, filled to the brim with water and not a hair over. The surface is completely flat.\n\nWhile you are looking at it, a ring goes out from the middle of it, reaches the stone, and comes back. Nothing dropped. Nothing moved. The air in the room has not stirred at all.', {}],
  // The Waking Hall.
  ['furn_exo_benches', 'zone_exo_waking', 'rows of benches', 'furniture',
   'Plain benches in rows, facing a floor rather than an altar, worn to a shine in the places people sit and nowhere else. There are enough of them for two hundred and eleven people and there are two hundred and eleven of them.', {}],
  ['furn_exo_worn_floor', 'zone_exo_waking', 'the worn patch', 'furniture',
   'A patch of the stone floor at the far end, worn pale, about the size of a person standing. It is not on a step and it is not marked out. Everyone leaves a foot of space around it without appearing to think about it.', {}],
  // The Long Table.
  ['furn_exo_table', 'zone_exo_table', 'the long table', 'furniture',
   'Forty feet of scrubbed board on trestles with benches down both sides. Neither end is the head. If you sit at one of them, within a minute somebody will sit at the other, and it will not be pointed.', {}],
  ['furn_exo_hearth', 'zone_exo_table', 'the hearth', 'furniture',
   'A stone hearth with three pots on it, the smallest of which is the one everybody watches. A ladle hangs on a nail. A stack of bowls, and a trough of water for washing them, and no one to do it for you.', {}],
  ['furn_exo_slate', 'zone_exo_table', 'the day slate', 'furniture',
   'A slate by the door with the day written on it in one word. Today it says BARLEY. Underneath, much smaller and in a different hand, somebody has written AGAIN, and nobody has rubbed it out.', {}],
  // The Wash House.
  ['furn_exo_copper', 'zone_exo_wash', 'the copper', 'furniture',
   'A great copper at the end of the duckboards with a fire under it and a jug on the ledge. It has been re-bottomed twice, and you can see both repairs, and both of them are better work than the original.', {}],
  ['furn_exo_trough', 'zone_exo_wash', 'the long trough', 'furniture',
   'A wooden trough the length of the room, silver with steam, with a plug chain at one end and a row of hooks above it. Every towel on the hooks is a different colour and each has plainly been the same person\'s towel for years.', {}],
  // The Dormitory.
  ['furn_exo_cots', 'zone_exo_dorm', 'rows of beds', 'bed',
   'Beds down both walls with a chest at the foot of each and nothing on top of any chest. The same blanket, sixty times. The same pillow, sixty times. It is not bleak. It is somehow the opposite, and working out why takes a while.', {}],
  ['furn_exo_boots_book', 'zone_exo_dorm', 'a pair of boots with a book on them', 'furniture',
   'Somebody\'s boots, under the last bed, set square, with a book laid open face-down across them. It is a book about tides. There is no sea within four hundred miles of here.\n\nIt is the single most personal object in a room that sleeps sixty.', {}],
  // The Mending Room.
  ['furn_exo_drawers', 'zone_exo_mending', 'the wall of drawers', 'furniture',
   'A hundred small drawers, each labelled in a small square hand: SPLINT, LINEN BOILED, WILLOW, HONEY, TEETH. The last one is at the bottom, where you would have to kneel to open it, which is somebody being kind.', {}],
  ['furn_exo_sickbed', 'zone_exo_mending', 'two beds and a screen', 'bed',
   'Two beds with a folding screen between them, both made up, both empty. Pinned inside the door where the patient can see it and the physician cannot, a child\'s drawing of a shape with a great many straight lines going up out of it.', {}],
  // The Creche.
  ['furn_exo_slatewall', 'zone_exo_creche', 'the slate wall', 'furniture',
   'A wall of slate at child height with a tin of chalk on a ledge. The chalk is counted. There are eleven pieces in the tin and eleven children in the room and this has never once been a problem.', {}],
  ['furn_exo_pegs', 'zone_exo_creche', 'a row of pegs', 'furniture',
   'Eleven pegs at knee height with a coat on each, in order of size, smallest at the door end. Nobody has ever been told to hang them that way and nobody remembers when it started.', {}],
  // The Open Door.
  ['furn_exo_ledger', 'zone_exo_opendoor', 'the ledger', 'furniture',
   'A ledger open on a stand with a pen beside it, going back years in a dozen hands. First names and dates and nothing else. Some names appear once. One name appears eleven times over nine years, always in the spring.', {}],
  ['furn_exo_guestbeds', 'zone_exo_opendoor', 'six made beds', 'bed',
   'Six cells off the hall, each with a bed made up, a stool, a shelf and a jug. One of them has been made up fresh this week and the dust on the shelf says it has been three years since anybody slept in it.', {}],
  ['furn_exo_hallfire', 'zone_exo_opendoor', 'the hall fire', 'furniture',
   'A fire at the end of the hall with a chair pulled up to it. Neither is for anybody in particular. In a compound that measures its oil to the spoonful, this burns all night, every night, for a door that is propped open with a stone.', {}],
  // The Quiet Ground.
  ['furn_exo_bier', 'zone_exo_quiet', 'the stone bier', 'furniture',
   'A slab of dressed stone down the middle of the room, cold to the hand, with a fold of linen at the head of it. There is a name chalked on the end today.', {}],
  ['furn_exo_lectern', 'zone_exo_quiet', 'the lectern book', 'furniture',
   'Every name, in order, going back to a first entry that is not the first person to die here but the first one they had the paper to write down.\n\nThe last three entries are in the same hand as the first forty. You check twice. It is the same hand.', {}],
  // The Bench.
  ['furn_exo_toolboard', 'zone_exo_bench', 'the tool board', 'furniture',
   'Every tool hung on its own painted outline, and not one outline empty. In the dark, from the door, you could see in a second which one was missing, which is what it is for.', {}],
  ['furn_exo_drawing', 'zone_exo_bench', 'the drawing on the wall', 'furniture',
   'A very tall structure, in section, dimensioned to the sixteenth of an inch, drawn in three hands over what must be twenty years. The middle third is in a small neat hand. The top is older and looser. The corrections are heavy and recent and there are a great many of them.\n\nNowhere on it is there a title, a date, or a name.', {}],
  // The Seed Vault.
  ['furn_exo_seeddrawers', 'zone_exo_seed', 'four hundred drawers', 'furniture',
   'Floor to ceiling, four hundred and six of them, each with a name, a year, and a number that goes down by one or two a season and occasionally back up by a hundred. Some of the years on these labels are older than the Basin.', {}],
  ['furn_exo_thermometer', 'zone_exo_seed', 'the thermometer and log', 'furniture',
   'A thermometer screwed to the door frame with a log hanging beside it on a string. Two readings a day, every day, in two different hands. There are no gaps anywhere in it.', {}],
  // The Glasshouse.
  ['furn_exo_beds', 'zone_exo_glass', 'the growing beds', 'furniture',
   'Beans up strings, tomatoes tied back with rag, a bed of greens, and at the far end a stand of something with a red stem you have never seen before, staked and labelled and watched.', {}],
  ['furn_exo_watercan', 'zone_exo_glass', 'a watering can', 'furniture',
   'A can with a fine rose on it, filled, standing at the end of the row that has not been done yet. It is exactly where the person doing the row would want it to be, and there is nobody in the glasshouse.', {}],
  // The Standing Charge.
  ['furn_exo_plant', 'zone_exo_charge', 'the generator', 'machine',
   'A single generator on a concrete pad, bedded on rubber, running at a speed it has clearly been running at for years. The floor around it is cleaner than the sick room. There is not one drip tray in the building because there has never been anything to catch.', {}],
  ['furn_exo_plantlog', 'zone_exo_charge', 'the log', 'furniture',
   'Twelve years of one line a day on the wall: oil, hours, load. No gaps. One entry, six years back, is three lines instead of one, and the third line reads A BIRD.', {}],
  // The Gate House.
  ['furn_exo_rota', 'zone_exo_gatehouse', 'the rota table', 'furniture',
   'A table with the gate rota chalked straight onto it, three weeks ahead. Every name is in the same hand, and it is not the hand of anybody who has been in this room today.', {}],
  ['furn_exo_bell', 'zone_exo_gatehouse', 'a bell with no rope', 'furniture',
   'A good bell, bronze, mounted under the eave outside and reachable from the upper floor. There is no rope on it and there is no rope in the room, and the bell has been polished.', {}],
];

// ═════════════════════════════════════════════════════════════════════════════
// WRITE
// ═════════════════════════════════════════════════════════════════════════════

function insideNpc(d) {
  const tree = { root: { actions: [], first: d.first, options: [], text: d.text, text_by_relation: d.byRel } };
  for (const [k, [label, text]] of Object.entries(d.nodes)) {
    tree.root.options.push(opt(label, k));
    tree[k] = node(text, [
      ...Object.entries(d.nodes).filter(([k2]) => k2 !== k).map(([k2, [l2]]) => opt(l2, k2)),
      opt('Nothing.', 'bye'),
    ]);
  }
  tree.root.options.push(opt('Nothing.', 'bye'));
  tree.bye = node(d.byeText || '"Mind how you go."\n\nAnd that is that, and they go back to it.');
  return npc({
    id: d.id, name: d.name, sex: d.sex, home_zone: d.zone, description: d.desc,
    chitchat: d.chitchat, dialogue_tree: tree,
    flags: { clothing_layers: d.clothing, personality: d.personality },
    vendor_inventory: (d.stock || []).map(([item_id, price]) => ({ item_id, min_trust: 0, price })),
    vendor_shop_name: d.shop || null,
    vendor_stock_size: d.stock ? d.stock.length : 10,
  });
}

let n = 0;
for (const person of [TACE, JOSIAH, HOPESTILL]) { write('npcs', person.id, person); n++; }
for (const d of INSIDE) { const p = insideNpc(d); write('npcs', p.id, p); n++; }

let f = 0;
for (const [fid, zone_id, name, object_type, description, flags] of FURNITURE) {
  write('furniture', fid, {
    description, flags, hp: null, hp_max: null, id: fid, light_type: null,
    lumen_output: null, name, object_type, power_draw_kw: null, price: 0, zone_id,
  });
  f++;
}

// ── The two errands ──────────────────────────────────────────────────────────
//
// They are deliberately errands that refuse to be about anything, which is the register the
// Oracle-9 chain established for this order: carry a box and do not open it, then walk round a wall
// and look at nothing. No player-visible line in either of them names a mechanism, and the second
// giver is explicit that there is nothing to see.
//
// What is actually being measured is not a skill. It is whether you will do a pointless thing
// carefully. That is never said by anybody.
write('quests', 'quest_terminus_1', {
  category: null,
  description: 'Ivo Stannard has a debt he cannot settle. He has tried to pay it eleven times and they will not take money from him, and he will not say why. He wants somebody who is not him to carry a sealed box up the road, leave it at the gate, and bring the empty back. He was very clear that the box is not to be opened, and then he was clear about it again, and then he apologised for being clear about it twice.',
  fail_on: [], id: 'quest_terminus_1', meta: {}, name: 'Nothing Owing',
  objectives: [
    { desc: 'Take the sealed box up the road and leave it at the gate.',
      emotes: ['{who} sets the box down in front of the gate and steps back off it.'],
      id: 'o_gate', type: 'visit', zone: 'zone_terminus_1210_940' },
    { desc: 'Bring the empty back to Ivo Stannard at Last Requisition.',
      emotes: ['{who} comes back down the road with an empty box and nothing to report.'],
      id: 'o_back', type: 'visit', zone: 'zone_terminus_1202_940' },
  ],
  penalties: {}, quest_type: 'standard', repeatable: 0,
  rewards: { credits: 90, flags: [{ flag: Q1, scope: 'player', value: 'done' }], items: [], xp: 22 },
  updated_at: '1787000000',
});
write('quests', 'quest_terminus_2', {
  category: null,
  description: 'Tace Ambler wants you to walk the outside of the wall. All of it: the north face, round the far side, the south face, and back to her stool in the middle of the road. She said there is nothing to see and that she was not going to pretend otherwise, and she asked you not to ask what it was for, on the grounds that she would only say something she would be embarrassed about later.',
  fail_on: [], id: 'quest_terminus_2', meta: {}, name: 'The Long Way Round',
  objectives: [
    { desc: 'Walk the north face of the wall.',
      emotes: ['{who} walks the north face with the wall on their right and does not look up at it once.'],
      id: 'o_north', type: 'visit', zone: 'zone_terminus_1220_930' },
    { desc: 'Walk the far side of the wall.',
      emotes: ['{who} comes round the eastern face, where nobody from the road can see them at all.'],
      id: 'o_east', type: 'visit', zone: 'zone_terminus_1230_940' },
    { desc: 'Walk the south face of the wall.',
      emotes: ['{who} works along the south face with the salt throwing the light up under their chin.'],
      id: 'o_south', type: 'visit', zone: 'zone_terminus_1220_950' },
    { desc: 'Go back to Tace Ambler on the road.',
      emotes: ['{who} comes back up the road having gone all the way round, which most people do not.'],
      id: 'o_back', type: 'visit', zone: 'zone_terminus_1207_940' },
  ],
  penalties: {}, quest_type: 'standard', repeatable: 0,
  rewards: { credits: 120, flags: [{ flag: Q2, scope: 'player', value: 'done' }], items: [], xp: 30 },
  updated_at: '1787000000',
});

// ── Patching the two people who were already here ────────────────────────────
//
// Read, change the two things that moved, write back. Their prose was hand-written in pass 1 and
// is better than anything a table in this file would produce, so nothing else about them is
// regenerated. Verity Strand's dialogue in particular is load-bearing: the whole admission chain
// is built to honour a line she has been saying since the day she shipped.
const verity = readJson('npcs', 'npc_terminus_warden');
if (verity) {
  // She moves up the road to the gate itself. The redraw put the wall eleven tiles further east
  // than pass 1 did, and she was standing where the road now is.
  verity.home_zone = 'zone_terminus_1210_940';
  verity.work_zone_id = 'zone_terminus_1210_940';
  // ONE new branch, and only for somebody who has already been let in. She does not congratulate
  // them and she does not explain anything, because the child did the explaining and the child
  // explained nothing.
  verity.dialogue_tree.root.options.unshift(
    opt('The child let me in.', 'inside', { conditions: [{ flag: ADMITTED, op: 'set' }] }));
  verity.dialogue_tree.inside = node(
    '"She does that."\n\nVerity does not move out of the slot, and does not look at the gate, and there is nothing at all in her face that says this is a day different from the last four thousand.\n\n"I will say the one thing and then I will not mention it again. In there, nobody is going to tell you anything. Not because they are keeping it from you. Because they cannot say it and have it still be true, and they have all agreed about that so long ago that they have forgotten anybody would need telling."\n\n"So you are going to spend a while thinking you are being frozen out. You are not. Eat with them."',
    [opt('Right.', 'bye')]);
  write('npcs', 'npc_terminus_warden', verity);
}

const ivo = readJson('npcs', 'npc_terminus_quartermaster');
if (ivo) {
  ivo.home_zone = 'zone_terminus_1202_940';
  ivo.work_zone_id = 'zone_terminus_1202_940';
  // The errand, and the one plainly-spoken beat in the whole district. He is allowed it because he
  // is the man who touched the machine and is not going with them, and nobody else may have it.
  const root = ivo.dialogue_tree.root;
  root.options = [
    opt('You look like you want something.', 'box', { conditions: [{ flag: Q1, op: 'unset' }] }),
    opt('I brought the empty back.', 'box_done', { conditions: [{ flag: Q1, op: 'set' }] }),
    ...(root.options || []),
  ];
  ivo.dialogue_tree.box = node(
    'He puts the pencil behind his ear, which for him is sitting down.\n\n"I owe them for a thing. Eleven years ago, and it is not money, and I have tried to make it money eleven times because money is a thing I understand." He taps a flat sealed box on the counter. "They will not take it off me. Off me specifically. I walk it up there and it comes back down."\n\n"So take it up and leave it at the gate and bring the empty back. And do not open it, and I am going to say that twice, and then I am going to apologise for saying it twice, because you have not given me any reason."\n\nHe does. Both.',
    [opt('All right.', 'box_take', { actions: [{ action: 'START_QUEST', quest_id: 'quest_terminus_1' }] }),
     opt('What is in it?', 'box_what'),
     opt('No.', 'bye')]);
  ivo.dialogue_tree.box_what = node(
    '"Nothing you would want and nothing you could sell."\n\nHe looks at the box, and then out at the road, and for a moment he is somewhere else entirely.\n\n"It is a set of gauges. Good ones. I made them, before, when I had hands that could." He turns one of them over, and you see the joint at the knuckle where it is not a knuckle. "Eleven years I have been getting them exactly right and they will not take them, and they will not tell me why, and I know why, and I am not going to say it out loud in my own shed."\n\n"Take the box or do not. It is the only thing I have ever asked anybody in this valley for."',
    [opt('All right.', 'box_take', { actions: [{ action: 'START_QUEST', quest_id: 'quest_terminus_1' }] }),
     opt('No.', 'bye')]);
  ivo.dialogue_tree.box_take = node(
    '"Right." He slides it across. "Gate. Leave it. Come back."\n\nAnd he picks up the pencil and goes down the list again, and does not look at you leaving.',
    [opt('Right.', 'bye')]);
  ivo.dialogue_tree.box_done = node(
    'He takes the empty box off you and turns it over twice, and there is nothing written on it and nothing in it, and something in his shoulders goes down about an inch.\n\n"Right," he says. "Right."\n\nHe puts it under the counter with a great deal of care, on top of the other ten.\n\n"Ambler will talk to you now. She will pretend that is a coincidence."',
    [opt('Right.', 'bye')],
    [{ action: 'ADJUST_REPUTATION', delta: 60, ideology_id: EXODUS, reason: 'Nothing Owing' }]);
  write('npcs', 'npc_terminus_quartermaster', ivo);
}

console.log(`terminus people: ${n} NPCs, ${f} furniture, 2 quests, 2 patched (Verity Strand, Ivo Stannard)`);
