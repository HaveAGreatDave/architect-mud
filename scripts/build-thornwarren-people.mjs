// THE THORNWARREN, second pass: the people in the rooms, the things they make, the things at the
// gate, and the way in.
//
//   node scripts/build-thornwarren-people.mjs && npm run content:import
//
// Re-runnable: it overwrites its own output and nothing else. Run it AFTER build-scarletwastes.mjs,
// which builds the fifteen rooms these people stand in.
//
// ── The rule everything below is written under ───────────────────────────────
//
//   A MUTATION IS A TRADE, AND THE TOWN IS ORGANISED AROUND WHAT EACH BODY TURNED OUT TO BE
//   GOOD FOR.
//
// Nobody here is "a mutant". They are the woman whose hands run cold enough to hold the stock, the
// man who takes ingots off the fire because his skin does not care, the one who does not sleep and
// therefore owns the night rota. Every job in this town is held by the person whose body suits it,
// and the rotas are chalked on walls where anybody can read them. That is the difference between
// this place and a freak show, and NO LINE OF DIALOGUE ANYWHERE STATES IT.
//
// ── The four things that must stay true ─────────────────────────────────────
//
//   1. THE OUTSIDE IS A HORROR AND THE INSIDE IS A KITCHEN, and unlike the Exodus, here the two are
//      often in the same room. The Fleshery is a body-horror set piece AND a clinic with a mop and
//      a kettle, and neither cancels the other.
//   2. NOBODY EVER ARGUES THAT THEY ARE NOT MONSTERS. Not one line defends the town or invites the
//      player to revise. The revision is the player's own work or it does not happen.
//   3. THE BITTERNESS IS SPECIFIC, NEVER A SPEECH. Every adult here has been turned back at a
//      Basin checkpoint. It comes out as a date, a place, a fact, dropped flat and moved past.
//      Anybody who monologues about the Ascendants has been written wrong.
//   4. THEY TAKE CARE OF THEIR OWN, VISIBLY AND WITHOUT COMMENT. The rota is the love letter.
//
// Aesthetically: chaos. Nothing matches, everything is made of eleven other things, no two objects
// in a room came from the same century. But nothing is dirty and nothing is broken, because these
// people mend. Chaos is a look here, not a failure.
//
// Names are blunt material nouns, matching the six who already shipped (Gristle Thole, Bracken
// Hale, Sill Moraine, Rindle Ashcroft, Ossa Vurn, The Chorus). Checked against all 228 existing
// NPCs for the unique-name rule.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const WILD = 'ideology_wildblood';

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

const npc = (o) => ({
  banter: [], behaviour_graph: {}, chitchat: [], faction: WILD,
  home_activities: [], hp: 30, hp_max: 30, npc_type: 'npc',
  studio_zone_id: null, vendor_inventory: [], vendor_restock_rate: 1,
  vendor_schedule: {}, vendor_shop_name: null, vendor_stock_size: 10,
  wander_zones: [], wanders: 0,
  ...o,
  work_zone_id: o.work_zone_id ?? o.home_zone,
});
const node = (text, options = [], actions = []) => ({ actions, options, text });
const opt = (label, next, { actions = [], conditions = [] } = {}) =>
  ({ actions, conditions, enabled: true, label, next });

const ADMITTED = 'thorn_admitted';
const TOLL = 'thorn_toll_done';

// ═════════════════════════════════════════════════════════════════════════════
// THE PEOPLE
// ═════════════════════════════════════════════════════════════════════════════
//
// Each entry names the mutation in the DESCRIPTION and never anywhere else, and every one of them
// is the reason that person has that job. Nobody says so.
const PEOPLE = [
  {
    id: 'npc_thorn_quarrel', name: 'Quarrel Nine', sex: 'female', zone: 'zone_thorn_gatehouse',
    personality: 'guard', hp: 60,
    clothing: ['a coat of plate and hide, cut for shoulders that are not the usual shape',
               'a shirt with the left sleeve gone entirely', 'boots, resoled with tyre'],
    desc: 'She is standing in the gate house door because she is too tall for the gate house, and she has to duck to get into her own guardroom, and she does it eleven times a shift without appearing to notice.\n\nHer left arm is longer than her right by most of a forearm and ends in a hand with too many bones in it. She uses it to reach things down off high shelves without moving her feet, and to hold you at a distance that is exactly out of your reach and exactly inside hers, and she is doing the second one now.\n\nShe is not hostile. She is not going to move either.',
    chitchat: [
      'This is the gate. You are outside it.',
      'I am not going to make you leave. I am going to not let you in.',
      'Look at the road for a bit. It is a good road.',
      'Two hours on, four off. It is not a bad shift.',
      'You want me to say something frightening. I would rather not.',
      'The masks are for the road. This is the gate.',
    ],
    first: '"Stop there." She does not raise her voice and does not need to. "You have come a long way and you are going to be told no, so I will tell you fast and you can decide what to do with the afternoon."',
    text: '"Still outside."',
    byRel: {
      known: '"You again." She shifts, and the gate house door frame creaks. "Still outside."',
      familiar: '"There you are." She reaches something down off a shelf without looking at it. "Still outside. For now."',
      close: '"Come in out of the sun a minute," she says, and stands aside from a doorway you still cannot use.',
    },
    nodes: {
      why: ['Why not?',
        '"Because of what happened the last four times."\n\nShe says it without any heat at all.\n\n"Twice it was Ascendant survey crews with a paper saying this land was theirs. Once it was a Long Watch pair who wanted to count us. Once it was a man on his own who was exactly as harmless as you look and came back in the spring with eleven friends and a truck."\n\n"So. No. It is not about you. It has never once been about the person standing where you are standing."'],
      city: ['You do not think much of the Basin.',
        'She considers the question like it is a piece of work.\n\n"I went to Coldwater when I was nineteen. Got to the checkpoint at the Yards. There is a frame there you walk through and a man behind glass who reads what it says about you."\n\nA pause, and she looks down the road rather than at you.\n\n"He was not cruel about it. That is the bit people get wrong. He was bored. He had done it forty times that day and I was the forty-first and he did not look up."\n\nShe rolls her shoulder, the long one.\n\n"Anyway. Nothing to tell. Everyone here has that story and everyone here is bored of it."'],
      masks: ['What is with the road?',
        '"The road works."\n\nShe almost smiles, and it is the first thing in the conversation she has plainly enjoyed.\n\n"You came up it. You are here and you are being polite to me. It works."\n\nAnd she does not say another word about it, and does not offer to explain what is on the road, and there is something about the way she stopped that suggests the explanation would be very boring indeed.'],
      // The toll appears to anyone who has stood here and asked. It is not gated on rep, because
      // rep is what you have done for people and she has never seen you do anything.
      work: ['Is there anything I could do?', null],
    },
    special: 'quarrel',
  },
  {
    id: 'npc_thorn_pitch', name: 'Pitch Halloway', sex: 'male', zone: 'zone_thorn_longfire',
    personality: 'vendor', shop: 'The Long Fire',
    clothing: ['an apron burned through at the front and patched with tin', 'a vest, no shirt', 'clogs'],
    desc: 'A wide man working six pots at once with a ladle in each hand and a third under his arm. He has eleven fingers and every one of them is doing something.\n\nHe tastes off the back of his wrist rather than off the spoon, holding it against the inside of his lip for a moment before he swallows, and what he is checking for is not seasoning. Everything that goes into a Thornwarren pot comes off ground that is trying to kill them, and he is the reason nobody has died of dinner in twenty years.',
    chitchat: [
      'Sit. Eat. Then talk, if you have got to.',
      'That one is fine. That one is fine. Not that one.',
      'Nobody pays. Put your name on the board if you feel bad about it.',
      'Bones in, always. It is the bones that make it.',
      'Everything out there wants to poison you. Most of it is bad at it.',
    ],
    first: '"You are the one at the gate." A bowl arrives before you have agreed to anything. "Eat that. It is safe. I would know."',
    text: '"Eat something."',
    byRel: {
      known: '"You." A bowl. "Eat."',
      familiar: '"I did the one you liked." He had. He remembered.',
      close: 'The bowl is already poured and already on the bench and he does not mention it.',
    },
    nodes: {
      pots: ['What is in the third pot?',
        '"Not sure yet."\n\nHe stirs it, tastes it off his wrist, makes a face that is entirely professional, and stirs it again.\n\n"Somebody brought in a sack of something off the north flats. Looks like it should be food. Half of what looks like it should be food out here will shut your kidneys in a day and a half." He puts the lid back. "So it sits in the third pot for a week and it goes to me first and to nobody else, and if it is all right in a fortnight it is dinner."\n\nHe says this the way another man would say he is thinking about painting the shed.'],
      board: ['What is the owing board?',
        '"Who the town owes."\n\nHe wipes his hands.\n\n"Nobody pays for food. So instead it goes up there: what you brought in, what you did, what you are owed. Roof crew are owed a lot. Gate shift are owed a lot. The people in the Kept are owed everything and cannot do anything, so their names are at the top and they stay there."\n\nA shrug.\n\n"It does not settle. It is not supposed to settle. It is just so everybody can see it."'],
    },
    stock: [
      ['item_wb_bone_broth', 8], ['item_flat_bread', 3], ['item_soup_bowl', 6],
      ['item_wb_thorn_tea', 12], ['item_water_bottle', 4], ['item_herb_bundle', 10],
      ['item_bar_jerky', 12],
    ],
  },
  {
    id: 'npc_thorn_brine', name: 'Brine Tack', sex: 'female', zone: 'zone_thorn_bath',
    personality: 'chatty',
    clothing: ['a wrap, permanently damp, and she does not appear to mind', 'nothing much else', 'wooden pattens'],
    desc: 'She is in the steam and of it. Her skin is faintly, permanently wet, and it does not dry, and it never has, and in any other room in the world that would be a problem. In this one she can stand at the copper for nine hours without going down, which is why she is the one who does.\n\nShe talks constantly, to everybody, about nothing, and it is the most relaxing sound in the Thornwarren.',
    chitchat: [
      'In you get. Middle tub. Mind the step.',
      'No, that one is too hot. That one is for Ferrous.',
      'Towels on the left, and bring it back.',
      'I have been in here since the sun was on the other side of everything.',
      'Everybody talks in a bathhouse. It is the rules.',
    ],
    first: '"Oh, you are the one from outside." She does not stop what she is doing. "In or out, love, the heat gets away."',
    text: '"In or out, the heat gets away."',
    byRel: {
      known: '"Back again. Middle tub."',
      familiar: '"I saved you the middle one." She had not, and she had.',
      close: 'She is already talking when you come in, halfway through a sentence, and you are expected to catch up.',
    },
    nodes: {
      water: ['This must take a lot of water.',
        '"It does and we have got it."\n\nShe is enormously pleased about this and makes no attempt to hide it.\n\n"Everything off every roof, down the tanks, through Sill\'s beds, into the cistern. Best water for sixty miles and I get the run-off for the tubs and then that goes on the Netting." She taps the copper. "Nothing leaves. It goes round."\n\nA pause.\n\n"They have got a river in Coldwater and they drink out of a machine. Anyway."'],
      look: ['Nobody in here is covering anything up.',
        'She stops, for the first time, and looks at you with real curiosity rather than any offence.\n\n"Where would we put it?"\n\nAnd she goes back to the copper, and after a moment says, in exactly the same tone as everything else, "You have got a scar on your back you did not want anybody to see and I saw it in the first four seconds and I have not thought about it since, and neither has anyone else. That is the whole of what this room is for."'],
    },
  },
  {
    id: 'npc_thorn_ferrous', name: 'Ferrous Bight', sex: 'male', zone: 'zone_thorn_foundry',
    personality: 'vendor', shop: 'The Foundry', hp: 45,
    clothing: ['a hide apron, scorched to board', 'no shirt at all', 'boots with the toes cut out'],
    desc: 'He reaches into the fire and takes out a piece of stock with his bare hand, carries it four steps, and sets it on the anvil.\n\nHis skin is dark and dull and slightly wrong at the edges, and it sheds heat the way a leaf sheds water. He is not showing off. Nobody in the building looks up. He got this job because of this, the same way the potter got his and the woman in the cold store got hers, and if you say anything about it he will be politely baffled.',
    chitchat: [
      'Made to be mended. All of it.',
      'Bring it back when it breaks and I will show you where it broke.',
      'I do not make two the same. Nobody here is two the same.',
      'Leaf spring. Best steel that ever came out of the Basin, and they threw it away.',
      'Tell me how you hold it. Then I will make it.',
    ],
    first: '"Put your hands out." He looks at them, both sides, without touching. "Right. Ordinary. That is easy then."',
    text: '"Put your hands out."',
    byRel: {
      known: '"You. Ordinary hands." He goes back to the anvil.',
      familiar: '"Take that end," he says, and you do, and it is hot, and he does not notice.',
      close: 'There is a stool pulled up to the far bench that was not there before and is plainly for you.',
    },
    nodes: {
      blades: ['Every blade on that rack is different.',
        '"Every hand on this town is different."\n\nHe turns the work on the anvil.\n\n"That one is for Sump. Two thumbs on the left, none on the right, so it has got a hook on the pommel and no guard that side. That one is Quarrel\'s and it is stupid to look at because her arms are not the same length and a straight haft would tear her shoulder out in a year."\n\nHammer. Hammer. Hammer.\n\n"A city armoury makes one knife eleven hundred times and calls it a standard. I make eleven hundred knives once each. Mine work."'],
      city: ['Where does the steel come from?',
        '"Out there." He tips his head north. "Rail, leaf spring, hull plate. The Basin threw away better steel than it has ever made."\n\nHe sets the piece back in the fire, bare-handed.\n\n"Went in for a hopper of coke once. Twelve years back. Got as far as the weigh station on the north road." He turns the piece in the coals. "They would not take my money. Not would not sell to me, you understand. Would not take the money out of my hand."\n\nHe pulls the piece out.\n\n"So I make my own coke now. It is worse. It is fine."'],
    },
    stock: [
      ['item_wb_spurblade', 210], ['item_wb_ribsaw', 340], ['item_wb_socket_spike', 180],
      ['item_wb_thorn_flail', 260], ['item_wb_hide_apron', 90], ['item_scrap_metal', 7],
      ['item_pipe_wrench', 80],
    ],
  },
  {
    id: 'npc_thorn_wick', name: 'Wick Ollam', sex: 'female', zone: 'zone_thorn_milkhouse',
    personality: 'quiet', hp: 34,
    clothing: ['a coat worn indoors, always, and never buttoned', 'fingerless gloves she does not need', 'soft shoes'],
    desc: 'A small still woman standing with both palms flat on a rack of flasks. She has been doing that for a while.\n\nHer hands run about twenty degrees under yours. It is not a trick and it is not comfortable to shake, and it is the entire reason she has the most important job in the Thornwarren: two hundred and eleven flasks and no machine anywhere in the region that could hold them at temperature, and one woman who can.\n\nShe looks up when you come in and does not stop what she is doing.',
    chitchat: [
      'Shut the door. Please.',
      'Two hundred and eleven. It was two hundred and nineteen in the spring.',
      'Do not touch a rack. Touch me if you want to know what cold is.',
      'Every one of these is somebody who has not decided yet.',
      'It takes nine years to make what is in this room.',
    ],
    first: '"Shut the door." Then, after she has heard it shut: "Thank you. Most people leave it."',
    text: '"Shut the door behind you."',
    byRel: {
      known: '"You shut it." Approval, from her, is enormous. "Good."',
      familiar: '"Hold this a moment," and she puts a flask in your hand, which is a thing she does not do.',
      close: 'She takes her hands off the rack when you come in, which costs her, and does not mention it.',
    },
    nodes: {
      stock: ['What is in the flasks?',
        '"The Pool, settled."\n\nShe turns one in its felt so the label faces out.\n\n"You cannot use it as it comes. Straight out of the water it will kill you nine times in ten and the tenth is not worth having. It has to stand. Nine years, dark and cold, and then Tallow tests it and then it goes in a rack and waits for somebody."\n\nShe puts it back.\n\n"There is no more. Not anywhere. The Pool gives what it gives and it is not much and this is all of it, so when you hear somebody in the Basin say we hand it out, you will know exactly how much they know."'],
      gaps: ['There are gaps in the numbering.',
        'She does not look at the log.\n\n"Eighty-one, eighty-two, ninety-four, one-eleven, one-thirty."\n\nA pause.\n\n"Eighty-one was Renna Ford. Eighty-two was her brother, four days later, because he would not let her do it on her own." She lays her hands flat on the rack again. "Every gap is a person and I know all of them and that is on purpose. Somebody has to."\n\n"Tallow keeps the tally on her wall so the town can see the numbers. I keep this one so somebody keeps the names."'],
    },
  },
  {
    id: 'npc_thorn_tallow', name: 'Tallow Skeen', sex: 'female', zone: 'zone_thorn_fleshery',
    personality: 'doctor', hp: 40,
    clothing: ['a rubber apron over everything, cracked and scrubbed', 'sleeves to the shoulder', 'clogs'],
    desc: 'Her hands have too many joints in them. Not extra fingers: extra bends, three to a digit where there should be two, so that when she works they do something closer to flowing than to gripping.\n\nShe does the Quickening. She has done four hundred and eleven of them. She is unhurried and she is warm and she explains every single step before she does it, out loud, whether or not the person on the table can still hear her, and that is the most frightening thing about her by a considerable distance.',
    chitchat: [
      'You are not booked. It is fine. Look round.',
      'Nine days notice. Always nine. You need the nine.',
      'I will tell you everything I am about to do before I do it.',
      'The chair at the head is not for me.',
      'Most of them go the ordinary way. Most.',
    ],
    first: '"You are not on the board." She checks anyway, with a finger, all the way down. "No. Right. Come in, then, and do not touch the rack."',
    text: '"You are not on the board."',
    byRel: {
      known: '"Not on the board." She says it almost fondly now.',
      familiar: '"Sit in the chair if you like. The one at the head. It is a good chair."',
      close: 'She puts the kettle on without being asked, which in this room is a considerable thing.',
    },
    nodes: {
      how: ['What actually happens?',
        '"You lie down. I put a line in. It goes in slow, over about six hours, because fast is how you get the bad ones."\n\nShe is entirely matter of fact.\n\n"You will be awake for the first two and you will not want to be. Somebody sits in that chair and holds your hand the whole way and does not let go, and that is not sentiment, it is because people pull the line out."\n\nShe straightens the chair, which she does constantly.\n\n"Then nine days in the back room. Then you find out what you got."'],
      tally: ['What are the marks on the wall?',
        '"Four hundred and eleven Quickenings. One mark each."\n\nShe does not soften it and does not look away from you while she says it.\n\n"Three hundred and sixty came through the ordinary way. Thirty-eight got something that made their life harder and they are still here and most of them are all right. Nine are in the Kept and will not come out of it."\n\nA pause.\n\n"Four did not survive the nine days."\n\nShe goes back to the bench.\n\n"I could take those four off the wall. Everybody would let me. It is my wall. But then the next one to lie on that table would be told a number that is not true, and I have never yet been able to work out how a person would go on doing this job after that."'],
      chair: ['Who sits in the chair?',
        '"Whoever they ask for."\n\nShe straightens it again.\n\n"Usually a mother. Sometimes Marrow, if there is nobody. Twice it has been me, which is not ideal, because I have got both hands full."\n\nShe looks at the chair for a moment.\n\n"Nobody in this town does the six hours alone. Not once, not ever, not if we have to take somebody off the roof to sit there."'],
    },
  },
  {
    id: 'npc_thorn_marrow', name: 'Marrow Kell', sex: 'male', zone: 'zone_thorn_kept',
    personality: 'charity', hp: 32,
    clothing: ['a soft shirt, washed to nothing, no buttons', 'trousers with the knees gone', 'no shoes indoors'],
    desc: 'A rangy man moving very quietly between ten beds. His eyes have no whites left in them, which is startling for about four seconds and then stops being anything at all.\n\nHe does not sleep. Not badly, not a little: not at all, and has not since he was twenty-two, and so the night rota in this building has one name on it and it is his. He has been awake for thirty-one years and he is the calmest person in the Scarletwastes.',
    chitchat: [
      'Quietly, if you would.',
      'Bed four is having a bad day. Do not take it personally.',
      'Two hours, turn. Two hours, turn. It is not complicated.',
      'You can talk to them. All of them. Some of them answer.',
      'I do the nights. It suits me.',
    ],
    first: '"Come in." He does not stop. "Quietly, if you would, and you can stay as long as you like."',
    text: '"Quietly, if you would."',
    byRel: {
      known: '"You came back." He is pleased and does not stop moving.',
      familiar: '"Take that end," and it is a sheet, and you take it.',
      close: 'He puts a hand on your shoulder on the way past, briefly, and carries on down the row.',
    },
    nodes: {
      who: ['Who are they?',
        '"Bed one is Renna\'s brother. Bed three did the roof for forty years. Bed seven is nineteen."\n\nHe checks something, adjusts something.\n\n"They went into the Fleshery and what they got was not the good kind. That is all. There is no more to it than that and there is no story in it and I would rather you did not go looking for one."'],
      sign: ['Nobody is carried out alone.',
        '"That is Tallow\'s. She put it up after the fourth one."\n\nHe smooths a sheet.\n\n"It means what it says. There is a rota on that door for turning and there is a second one nobody writes down for sitting, and when one of them goes, the whole town is in this room. All of it. The gate shift comes off the gate."\n\nHe straightens up.\n\n"They can have the wall for an hour. We have decided that."'],
      city: ['A Basin clinic could do more for them.',
        'He is quiet for long enough that you think he has not heard.\n\n"Yes."\n\nHe goes to the next bed.\n\n"I took bed seven to Coldwater. Two years ago, in a cart, four days, with a letter from Gristle laid out like a physician writes. Got to the Yards checkpoint. They read the letter."\n\nHe turns her, carefully, and settles the pillow.\n\n"They were not cruel about it either."'],
    },
  },
  {
    id: 'npc_thorn_cobble', name: 'Cobble Enns', sex: 'female', zone: 'zone_thorn_whelp',
    personality: 'charity', hp: 30,
    clothing: ['a shapeless cardigan with everything in the pockets', 'a shirt buttoned wrong', 'slippers'],
    desc: 'They are sitting in the rocking chair with a bundle and are entirely unhurried about everything.\n\nTheir ears are wrong: too large, set too low, and mobile, and they track. Halfway through your sentence one of them turns toward the far end of the room, and eleven seconds later a child at that end starts to cry, and Cobble is already getting up.',
    chitchat: [
      'Sit down, you are looming.',
      'Nine on the list. It covers the week.',
      'It goes wrong here more than it should. We know the number.',
      'You get used to the name of the room. Everyone does.',
      'Shhh. Not you. Them.',
    ],
    first: '"Sit down, you are looming." They do not look up. "There. Now you are a chair and nobody minds you."',
    text: '"Sit down, you are looming."',
    byRel: {
      known: '"You. Sit." A bundle is very nearly handed to you.',
      familiar: '"Take her a minute," and it is not a question, and you do.',
      close: 'They are asleep in the chair and wake as you come through the door, before the door makes any sound.',
    },
    nodes: {
      numbers: ['What are the numbers by the door?',
        '"How many we lose."\n\nThey say it without any weight on it at all.\n\n"It is higher here than in the city. Considerably. The bodies are all different shapes and half of them do not know what they are trying to be yet, and some of them do not manage it."\n\nA pause. They shift the bundle.\n\n"We write it up because pretending would be worse. And then somebody wrote the other list under it, which is the ones who came through, and it is four times as long, and I am glad they did that and I would not have thought of it."'],
      name: ['The room has an unfortunate name.',
        'They look at you with genuine incomprehension for a second, and then get it, and laugh, and the laugh is not unkind.\n\n"Oh. Yes. You would hear it like that."\n\nThey settle back.\n\n"It is what it is called. It has been called that since before me. Nobody in this town has ever heard anything in it except a warm room with a stove going."\n\nAnd that is all they have to say about that, and they go back to the bundle.'],
    },
  },
  {
    id: 'npc_thorn_sump', name: 'Sump Rhee', sex: 'male', zone: 'zone_thorn_kiln',
    personality: 'labourer',
    clothing: ['clay to the elbow and everywhere else', 'an apron', 'bare feet, caked'],
    desc: 'At the wheel, and he has hands like Tallow\'s, three bends to a finger, and where hers flow over an incision his flow over clay. He works faster than looks possible and does not watch what he is doing.\n\nEverything the Thornwarren eats off came off this wheel. Every piece has a thumbprint pressed into the foot ring. They are all his thumbprint. Nobody has ever mentioned it to him.',
    chitchat: [
      'Do not stand there, you are in my light. I do not use it. Stand there anyway.',
      'A thousand bowls. Maybe two.',
      'Red glaze is for the jars. Do not pick those up.',
      'Everything breaks. I make more.',
      'By feel. I have not looked at the wheel in years.',
    ],
    first: '"Mind the boards." The wheel does not stop. "Everything on them is wet and everything on them is somebody\'s."',
    text: '"Mind the boards."',
    byRel: {
      known: '"You. Mind the boards."',
      familiar: 'He pushes a stool out with his foot without stopping the wheel.',
      close: 'There is a mug on the bench that is glazed better than the rest and has your initial cut into the foot, and he has never said anything about it.',
    },
    nodes: {
      jars: ['What are the red jars for?',
        '"Tallow."\n\nThe wheel goes.\n\n"Flasks live in felt for nine years. Glass takes the cold badly and metal takes it worse. These do not care." He lifts one off the wheel without looking at it. "Thicker in the shoulder than they look. Nine of them a month, every month, and about six survive the firing, and I have got a stack of eleven hundred going back to before I was born."\n\nHe sets it on the board.\n\n"If this kiln stops, the whole thing stops. Not the pots. The other thing."'],
      speed: ['You are not watching what you are doing.',
        '"No."\n\nHe centres another lump and opens it.\n\n"I stopped about fifteen years ago. It is better this way. Hands know it."\n\nA pause, and then, unexpectedly, he does look up.\n\n"There was a man came out here from a Basin works once, buying. Watched me for an hour. Offered me a job and a room and a name on the door and the whole of it." Back to the wheel. "Then he went and looked at the paperwork and came back and said he was sorry and it was not up to him."\n\n"He was sorry, actually. You could tell. Did not help."'],
    },
  },
  {
    id: 'npc_thorn_nettle', name: 'Nettle', sex: 'female', zone: 'zone_thorn_kept', hp: 12,
    personality: 'quiet',
    clothing: ['a cut-down coat with the sleeves rolled nine times', 'a shirt of somebody else\'s', 'no shoes'],
    desc: 'A girl of about ten sitting on the floor by bed seven with a book open on her knees, reading out loud, badly and steadily, to somebody who cannot tell her she is getting the words wrong.\n\nShe has a second set of small ridges coming up along her forearms and she picks at them when she is concentrating and has been told not to.',
    chitchat: [
      'I am on the rota. Look, that is me.',
      'She likes this one. I can tell.',
      'Marrow says I do the afternoons.',
      'I got put on the rota when I was eight. You have to be eight.',
      'What is it like where you are from?',
    ],
    first: '"Shh." She holds up a finger, finishes the sentence badly, and marks the place with a scrap of wire. "All right. Hello. Are you the one from outside?"',
    text: '"Hello."',
    byRel: {
      known: '"You came back." She marks her place. "I told her you would."',
      familiar: 'She budges over on the floor without looking up, and carries on reading.',
      close: 'She hands you the book, which is a considerable thing, and folds her arms, and waits to see whether you do it properly.',
    },
    nodes: {
      rota: ['You are on the rota?',
        '"Everyone is on the rota."\n\nShe says this with the absolute conviction of somebody stating that water is wet.\n\n"You have to be eight. Then you get put on. I do afternoons in here and I do Tuesday on the Netting, and I am not allowed on the roof yet because of the wind."\n\nShe considers you.\n\n"You are not on it. That is all right. You have only just got here."'],
      outside: ['What have you been told about the city?',
        '"That it is very big and it has got machines in the walls that look at you."\n\nShe picks at her forearm and stops herself.\n\n"And that I cannot go, not ever, because of these." She holds up an arm, entirely matter of fact about it, the way you would show somebody a freckle. "Marrow says maybe when I am older it will be different and Quarrel says it will not be, and Quarrel is usually right about things."\n\nShe finds her place in the book again.\n\n"It sounds loud. I would not want to leave her anyway. She likes this one."'],
    },
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// THE THINGS AT THE GATE
// ═════════════════════════════════════════════════════════════════════════════
//
// THE GUARDS ARE ENEMIES, NOT NPCS, AND THAT IS THE DESIGN. A thing that will talk to you can be
// bargained with, and these cannot: they stand in the road, they are the size of a truck, and they
// watch you go past. Quarrel Nine does the talking. They do the other thing.
//
// ⚠ `behavior` is NOT 'aggressive' or 'territorial' and there is no `behaviour_graph._start`,
// which is what makes them the first non-aggro enemies in the game (gameLoop.js:176 — `canAggro`
// is exactly those three, and nothing else ever aggros on its own). They will stand there forever.
// Attacking one sets `enemy.targetId` on the ordinary combat path and then it fights, and so does
// everything beside it. This is the only correct shape for "intimidating, and lethal if you start
// something": an aggressive enemy at a gate is a gate nobody can walk up to, which would break the
// whole approach.
const GUARDS = [
  {
    id: 'enemy_thorn_warden', name: 'a Gate Warden', hp: 320, hit: 16, dodge: 6,
    desc: 'It is eleven feet if it is an inch, and it is wearing a mask of bone and plate with the jaw wired open, and it is standing in the gateway with its hands loose at its sides doing absolutely nothing.\n\nThe proportions are wrong in a way that takes a moment to locate: the arms come down past the knee, and the shoulders have a second set of joints in them, and the whole of it is plated over in something dark and grained that is not armour because it has grown there.\n\nIt watches you the entire way up the road. It does not shift its weight. It does not appear to be breathing very often.',
    death: 'The Gate Warden goes down on one knee, and then over, and the mask comes off, and underneath it is a face, which is somehow much worse.',
    weapon: [{ min: 14, max: 26, type: 'kinetic' }, { min: 6, max: 12, type: 'edged' }],
    cries: [
      'The Gate Warden does not move.',
      'The Gate Warden turns its head very slightly and keeps turning it further than it should.',
      'Somewhere behind the thorn, something else that is this size answers.',
      'The wired-open jaw of the mask is not where the sound came from.',
    ],
    loot: [['item_wb_mask_lined', 1, 1, 25], ['item_wb_bone_plate', 1, 2, 40], ['item_scrap_metal', 2, 4, 60]],
  },
  {
    id: 'enemy_thorn_harrow', name: 'a Road Harrow', hp: 230, hit: 14, dodge: 11,
    desc: 'It walks the trophy road between the stakes, up and back, up and back, and it has been doing it for as long as anybody has watched.\n\nSomething has gone wrong with it in the direction of length. The spine is too long and carried too low, so it moves at a hunch on four points and rises onto two when it wants to look at something, and it is looking at something now.\n\nThe skulls wired to the stakes have been re-wired recently, and it is carrying the wire.',
    death: 'The Road Harrow folds up along its length, which takes a while, and the coil of wire rolls out of its hand and away down the road.',
    weapon: [{ min: 11, max: 20, type: 'edged' }, { min: 5, max: 9, type: 'kinetic' }],
    cries: [
      'The Road Harrow rises onto two points and stays there.',
      'The Road Harrow goes back to its wire.',
      'A bone flute somewhere up the road sounds four notes in a row and stops.',
      'The Road Harrow has closed about a third of the distance and you did not see it do that.',
    ],
    loot: [['item_wb_bone_plate', 1, 2, 45], ['item_wb_grave_salt', 1, 3, 40], ['item_bone_meal', 1, 2, 30]],
  },
  {
    id: 'enemy_thorn_cull', name: 'a Field Cull', hp: 180, hit: 13, dodge: 14,
    desc: 'Leaner than the others and much faster, working the open ground outside the wall in a wide slow circuit that is plainly a route.\n\nIt has too many eyes and they are not arranged in any pattern, and they do not blink together, and it can therefore look at the road, the ridge and you at the same time, and is.\n\nIt is not blocking anything. It is counting.',
    death: 'The Field Cull comes apart much more easily than the size of it suggested, and the last of the eyes to close is not looking at you.',
    weapon: [{ min: 9, max: 17, type: 'edged' }],
    cries: [
      'The Field Cull adjusts its circuit by about four feet and continues.',
      'Several of the eyes are on you. Several are not.',
      'The Field Cull stops. Then it goes on.',
    ],
    loot: [['item_wb_grave_salt', 1, 2, 45], ['item_bone_meal', 1, 3, 40], ['item_scrap_metal', 1, 3, 40]],
  },
];

// One at each gate, and the road ones on the trophy road that already exists north of the wall.
const GUARD_POSTS = [
  ['zone_scw_1046_967', 'enemy_thorn_warden', 1],       // outside the North Gate
  ['zone_scw_1046_985', 'enemy_thorn_warden', 1],       // outside the Sally Gate
  ['zone_scw_1046_966', 'enemy_thorn_harrow', 1],       // the trophy road
  ['zone_scw_1046_964', 'enemy_thorn_harrow', 1],
  ['zone_scw_1044_970', 'enemy_thorn_cull', 1],         // the circuit, outside the west wall
  ['zone_scw_1049_986', 'enemy_thorn_cull', 1],
];

// ═════════════════════════════════════════════════════════════════════════════
// THE THINGS THEY MAKE
// ═════════════════════════════════════════════════════════════════════════════
//
// Every weapon on Ferrous Bight's rack is cut for one specific body, and the shop copies are the
// ones whose owner died or outgrew them. That is why a hooked pommel and a two-hand haft of
// unequal length are for sale at all, and it is written into the descriptions rather than into a
// mechanic, because a weapon that only works for a mutated player is a weapon most players never
// see and a tag nothing else reads.
const ITEMS = [
  // ── Weapons ───────────────────────────────────────────────────────────────
  ['item_wb_spurblade', 'spurblade', 210, 700, 'weapon',
   'A heavy leaf-spring blade with a hook where a pommel should be, so a hand with no thumb can hold it closed. Ground, folded, ground again. The edge is better than anything the Basin sells at four times the price and the handle is wound with somebody else\'s bootlace.',
   { damage: { min: 5, max: 11 }, damage_type: 'edged', slot: 'weapon_hand', weapon: true,
     weapon_skill: 'blades', min_skill: { blades: 1 },
     description: 'A hooked leaf-spring blade, wound at the grip with a bootlace that has been replaced more recently than the wrapping under it.' }],
  ['item_wb_ribsaw', 'ribsaw', 340, 1400, 'weapon',
   'A two-hand blade on a haft whose grips are set at different heights, because it was made for somebody whose arms were not the same length and there was no reason at all for that to be a problem. Awkward for the first hour and then not.',
   { damage: { min: 8, max: 16 }, damage_type: 'edged', slot: 'weapon_hand', weapon: true,
     weapon_skill: 'blades', min_skill: { blades: 2 },
     description: 'A long two-hand blade with its grips set a hand apart in height. It is not a mistake and it took eleven attempts.' }],
  ['item_wb_socket_spike', 'socket spike', 180, 500, 'weapon',
   'A spike with no handle. Instead there is a socket, tapered and lined with hide, meant to be pushed onto something that has grown to a point. It has been sold four times and returned three, and Ferrous will not stop making them.',
   { damage: { min: 6, max: 12 }, damage_type: 'edged', slot: 'weapon_hand', weapon: true,
     weapon_skill: 'blades', min_skill: { blades: 1 },
     description: 'A hide-lined socket with a spike on the end of it. There is no grip because it was never meant to be gripped.' }],
  ['item_wb_thorn_flail', 'thorn flail', 260, 1100, 'weapon',
   'Two feet of the wall on a length of chain. It is still alive, which is the point: it has been cut and it is closing, and it goes on closing on whatever it is wrapped around. It has to be watered.',
   { damage: { min: 7, max: 14 }, damage_type: 'kinetic', slot: 'weapon_hand', weapon: true,
     weapon_skill: 'clubs', min_skill: { clubs: 1 },
     description: 'A living length of thorn wired to a chain. The spines are the length of your hand and it is not dead.' }],
  ['item_wb_hound_lash', 'hound lash', 150, 600, 'weapon',
   'Bracken Hale\'s pattern: a plaited lash with a weighted fall, made for turning something the size of a pony that has decided not to be turned. It has never once been used on a hound.',
   { damage: { min: 4, max: 10 }, damage_type: 'kinetic', slot: 'weapon_hand', weapon: true,
     weapon_skill: 'clubs',
     description: 'A long plaited lash with a weighted fall, worn shiny at the grip.' }],
  // ── Gear ──────────────────────────────────────────────────────────────────
  ['item_wb_mask_lined', 'a gate mask', 400, 900, 'clothing',
   'Bone and plate with the jaw wired open. At a hundred paces on the trophy road it is the most frightening object in the region.\n\nUp close it is quilted inside, stitched down flat at every edge, so it does not chafe on a long shift. Somebody\'s grandmother did the lining and did it well.',
   { armor_soak: { kinetic: 2 }, layer: 'armor', slot: 'head',
     description: 'A horror on the outside and a quilted rag lining on the inside, stitched flat at every edge.' }],
  ['item_wb_hide_apron', 'foundry apron', 90, 1600, 'clothing',
   'Hide scorched to the consistency of board, with a bib high enough to take a splash and a hem long enough to take a drop. Every burn on it is somebody else\'s.',
   { armor_soak: { fire: 3, kinetic: 1 }, layer: 'outerwear', slot: 'torso',
     description: 'A hide apron burned stiff, patched at the bib with a square of tin.' }],
  ['item_wb_bone_plate', 'plate of grown bone', 24, 400, 'material',
   'A curved sheet of something that grew rather than being cast, dense as horn and cool to the hand. The Foundry buys these and nobody asks where the last owner is.', {}],
  // ── Consumables ───────────────────────────────────────────────────────────
  ['item_wb_bone_broth', 'bone broth', 8, 350, 'food',
   'Thick, dark, and faintly gritty at the bottom, out of a pot that has never been allowed to go cold. Somebody has tasted this off the back of their wrist before it reached you.',
   { consumable: true, restore_hunger: 34, restore_hp: 6, stackable: true, description: 'A bowl of the Long Fire\'s big pot. It is very good and nobody will tell you what is in it.' }],
  ['item_wb_thorn_tea', 'thorn tea', 12, 120, 'drink',
   'Bitter and slightly numbing, brewed off the young growth at the top of the wall. It is what the Thornwarren drinks when the rain has been the wrong colour.',
   { consumable: true, restore_thirst: 20, restore_radiation: -6, stackable: true,
     description: 'A dark bitter infusion of new thorn. It numbs the tongue for about a minute.' }],
  ['item_wb_rad_poultice', 'drawing poultice', 45, 250, 'medicine',
   'Burnt bone, crushed limestone and something green, worked into a paste and spread on a rag. Gristle Thole\'s pattern. It draws, and it stings, and it works.',
   { consumable: true, treat_injury: { floor: 1, steps: 1 }, restore_radiation: -14, stackable: true,
     description: 'A grey-green paste on a folded rag, still slightly warm from being worked.' }],
  ['item_wb_grave_salt', 'grave salt', 18, 200, 'material',
   'Coarse crystals scraped off the pale ground where the rain stands. It preserves, it draws water, and it is one of the three things the Thornwarren has enough of.', {}],
  ['item_bone_meal', 'burnt bone meal', 9, 300, 'material',
   'Bone, burnt white and ground fine. It goes in the water beds, it goes in the poultices, and it goes on the Netting. Very little in this town is used for only one thing.', {}],
  ['item_wb_mutagen_raw', 'a raw draw', 900, 400, 'drug',
   'A flask drawn straight off the Pool and stoppered where it stood, the colour of a bruise and warm through the glass. It has not stood, it has not settled and it has not been tested.\n\nWick Ollam will tell you exactly what it does to a person who drinks it at this stage, at length, without being asked, and she will not sell you one.',
   { description: 'Unsettled Pool water in a red-glazed jar. It is warm and it should not be.' }],
];

// Craft recipes. Stationless, because the Thornwarren has no chem lab and never will: everything
// below is made on a bench, at a kiln, or over the Long Fire.
const RECIPES = [
  ['recipe_wb_bone_meal', 'Burn Bone Meal', 'goods', 'fabrication', 1, 6,
   'Burn bone white and grind it fine. It goes in the water beds, the poultices and the Netting.',
   [['item_bone_scrap', 2]], ['item_bone_meal', 2]],
  ['recipe_wb_poultice', 'Work a Drawing Poultice', 'medicine', 'medicine', 2, 12,
   'Burnt bone, grave salt and green growth, worked to a paste and spread on a rag. Gristle Thole\'s pattern, and he does not mind who has it.',
   [['item_bone_meal', 1], ['item_wb_grave_salt', 1], ['item_herb_bundle', 1]], ['item_wb_rad_poultice', 1]],
  ['recipe_wb_thorn_tea', 'Brew Thorn Tea', 'goods', 'fabrication', 1, 8,
   'New growth off the top of the wall, cut in the morning and brewed hard. What the town drinks when the rain has been the wrong colour.',
   [['item_herb_bundle', 1], ['item_water_bottle', 1]], ['item_wb_thorn_tea', 2]],
  ['recipe_wb_spurblade', 'Grind a Spurblade', 'weapons', 'fabrication', 3, 18,
   'Leaf spring, folded and ground and folded again, with a hook where the pommel should be. Ferrous Bight will show anybody how, once.',
   [['item_scrap_metal', 4], ['item_wb_bone_plate', 1]], ['item_wb_spurblade', 1]],
  ['recipe_wb_flail', 'Wire a Thorn Flail', 'weapons', 'fabrication', 2, 14,
   'Two feet of the wall on a length of chain, cut at dusk so it closes overnight. It has to be watered afterwards and everybody forgets.',
   [['item_scrap_metal', 2], ['item_wb_grave_salt', 1]], ['item_wb_thorn_flail', 1]],
  ['recipe_wb_mask', 'Line a Gate Mask', 'armor', 'fabrication', 2, 15,
   'The frightening half takes an afternoon. The lining takes three days, and it is the half that matters, because a mask that chafes comes off in the fourth hour of a six hour shift.',
   [['item_wb_bone_plate', 2], ['item_towel_rough', 1]], ['item_wb_mask_lined', 1]],
];

// ── The things in the rooms ──────────────────────────────────────────────────
//
// Two kinds, and the split matters more here than anywhere else in the world.
//
// The MUNDANE half is deliberately the bigger one, because it is the argument: a mop, a kettle, a
// rota, a plant on a sill. The Thornwarren is frightening from the road and it is a laundry from
// the inside, and if the furniture is all bone and flasks then the room is only ever the first of
// those.
//
// The BODY-HORROR half is never gratuitous and it is never explained. The tally board says four
// numbers. The Kept has ten beds and every frame is a different shape. Nobody in a description
// tells you how to feel about any of it.
//
// NOTHING HERE INVENTS A FLAG NOTHING READS. Everything below is prose on an ordinary furniture
// row; the only mechanical objects in the region are the ones that were already there.
const FURNITURE = [
  // The Fleshery — the room the faction turns on.
  ['furn_thorn_slab', 'zone_thorn_fleshery', 'the table', 'furniture',
   'A table with a drain in the middle of it and a lip all the way round, scrubbed to the grain. The restraints are padded, and the padding has been replaced recently, and the stitching on the new padding is the same stitching as the masks in the gate house.'],
  ['furn_thorn_tally', 'zone_thorn_fleshery', 'the tally board', 'furniture',
   'Four hundred and eleven marks in chalk, in rows, going back thirty years, with four different symbols in the set.\n\nThere is a key at the bottom in small letters. Three hundred and sixty. Thirty-eight. Nine. Four.\n\nNobody has rubbed out the last group and there is a clean patch of wall beside the board where it would have been very easy to start again.'],
  ['furn_thorn_chair', 'zone_thorn_fleshery', 'the chair at the head', 'furniture',
   'An ordinary chair, worn through at the arms, pulled up to the head of the table and square to it. It is not for the surgeon. Somebody sits in it for six hours and holds a hand and does not let go, and the wear on the arms is not from the person in the chair.'],
  ['furn_thorn_kettle', 'zone_thorn_fleshery', 'a kettle and one mug', 'furniture',
   'A kettle on a ring, and one mug, tea-stained, with a chip out of the rim. In the middle of everything else in this room they are the detail that will not leave you alone afterwards.'],
  // The Milkhouse — the stock.
  ['furn_thorn_racks', 'zone_thorn_milkhouse', 'the racks', 'furniture',
   'Two hundred and eleven red-glazed jars nested in cut felt, numbered, each label a date and a hand and a number. This is every Quickening the Thornwarren can perform for the next nine years and there is no second source anywhere.'],
  ['furn_thorn_stocklog', 'zone_thorn_milkhouse', 'the stock log', 'furniture',
   'Every flask in and every flask out, with a name against each. There are gaps in the numbering. Beside every gap, in the same small hand, is a note, and every note is a person, and one of them just says AND HER BROTHER, FOUR DAYS.'],
  // The Kept — the community half, and the hardest room in the region.
  ['furn_thorn_beds', 'zone_thorn_kept', 'ten beds', 'bed',
   'Ten wide beds and not one frame the same as another, because each was made at the Foundry to fit the person in it and remade when the person changed. Two of them have had a third rail added on one side, recently, in better steel than the rest.'],
  ['furn_thorn_turnrota', 'zone_thorn_kept', 'the turning rota', 'furniture',
   'Two hours, turn. Fourteen names, covering every hour of every day, initialled as it goes. One of the names is written much larger and much worse than the others and belongs to somebody who is ten.'],
  ['furn_thorn_sill', 'zone_thorn_kept', 'a plant on the sill', 'furniture',
   'A green thing in a red-glazed pot, watered, turned, thriving. It is the only cared-for growing thing in the building that is not a person, and somebody has moved it into the light twice today.'],
  // The Gate House — the highest-leverage object in the town.
  ['furn_thorn_maskrack', 'zone_thorn_gatehouse', 'the mask rack', 'furniture',
   'Eleven masks. Bone, plate, horn, a jaw wired open, one with too many sockets and nothing behind them.\n\nEvery one of them is lined. Quilted rag, stitched down flat at every edge so it does not chafe on a long shift, and two have been re-lined this season in a different cloth. There is a needle stuck in the cloth of the second one, still threaded.'],
  ['furn_thorn_gaterota', 'zone_thorn_gatehouse', 'the tally board', 'furniture',
   'Names against hours. Two on, four off. Somebody is owed a half day and it has been carried over three weeks running, and somebody else has written OI beside it.'],
  // The Long Fire.
  ['furn_thorn_trench', 'zone_thorn_longfire', 'the fire trench', 'furniture',
   'Forty feet of graded trench with six pots down it at six heights, so everything on it is cooking at its own speed. The big pot at the near end has not been allowed to go cold in nineteen years and everybody knows exactly how long it has been.'],
  ['furn_thorn_owing', 'zone_thorn_longfire', 'the owing board', 'furniture',
   'Not a bill. A list of what the town owes each person: roof hours, gate hours, water hauled, nights sat up. The people in the Kept are at the top because they cannot do anything, and they stay at the top, and nobody has ever proposed otherwise.'],
  // The Bathhouse.
  ['furn_thorn_tubs', 'zone_thorn_bath', 'three tubs', 'furniture',
   'Cut down from tank ends and set in the duckboards, one of them hot enough to hurt. There is a step into each and the step in the middle one has a second, lower step beside it that was added for somebody in particular.'],
  ['furn_thorn_brush', 'zone_thorn_bath', 'the big brush', 'furniture',
   'A scrubbing brush with a handle on both ends, which makes no sense until you see it used. It is for the ones who cannot reach their own backs any more, and somebody always does it, and nobody is ever asked twice.'],
  // The Foundry.
  ['furn_thorn_rack', 'zone_thorn_foundry', 'the blade rack', 'furniture',
   'Eleven blades and no two alike. A hooked pommel for a hand with no thumb. A two-hand haft with the grips a hand apart in height. One with no handle at all, only a hide-lined socket, because it went onto something that had grown to a point.\n\nEvery one of them was made for somebody. Some of those people are still alive.'],
  ['furn_thorn_anvil', 'zone_thorn_foundry', 'the anvil', 'furniture',
   'Rail steel on an elm stump, with a face polished by seventy years of use and a bright hollow in the middle of it. There are no tongs on the rack beside it. There have never been any tongs.'],
  // Rindle's.
  ['furn_thorn_case', 'zone_thorn_rindles', 'a locked case', 'furniture',
   'A glass case at the back with a card on it that reads ASK, and under that, smaller, DO NOT ASK TWICE. What is behind the glass is not obviously worth a lock, which is the most interesting thing about it.'],
  ['furn_thorn_priceboard', 'zone_thorn_rindles', 'the price board', 'furniture',
   'Priced in three currencies and adjusted per person, with the adjustments written up in the open where anybody can check them. Four names have a line through their prices entirely and the line is old.'],
  // The Chorus' Den.
  ['furn_thorn_cushions', 'zone_thorn_den', 'the cushions', 'furniture',
   'Hundreds of them, every colour a thing can be, none matching, in rings around a fire pit that is not lit. They are arranged by nobody and they are never wrong, and if you sit down in the outer ring somebody will quietly move you inward within a quarter of an hour.'],
  ['furn_thorn_hullplate', 'zone_thorn_den', 'a length of hull plate', 'furniture',
   'Ascendant work, unmistakable, hung on the wall among the salvage and the bone and a child\'s drawing. There is a hole punched clean through it from one side.\n\nNothing about how it is hung suggests a trophy. It is at the same height as everything else and it is not in the middle.'],
  ['furn_thorn_rota', 'zone_thorn_den', 'the rota', 'furniture',
   'Water, roof, gate, turning. Four columns, three weeks ahead, amended constantly in one hand.\n\nThis is the entire government of the Thornwarren, and it has worked for thirty years, which is longer than the Basin has managed anything.'],
  // The Physic.
  ['furn_thorn_instruments', 'zone_thorn_physic', 'the instrument case', 'furniture',
   'Laid out in order on folded cloth, and every one of them made across the yard at the Foundry. Two are shapes you have never seen in a clinic and are obviously for a joint that does not exist in most people.'],
  ['furn_thorn_drawers', 'zone_thorn_physic', 'the drawers', 'furniture',
   'Labelled in a small square hand. SPLINT, SHORT. SPLINT, LONG. SPLINT, WRONG WAY. HONEY. WILLOW. TEETH. TEETH, THE OTHER KIND.'],
  // The Sweetwater.
  ['furn_thorn_tubes', 'zone_thorn_sweetwater', 'the test rack', 'furniture',
   'Two glass tubes made up twice a day, every day, for years. The board above them goes back so far the earliest columns have been written over twice, and there is not one gap in it anywhere.'],
  ['furn_thorn_inlet', 'zone_thorn_sweetwater', 'the second inlet', 'furniture',
   'A plated inlet at the top of the beds, separate from the roof feed, for water hauled up from the Slake in a dry month. The rule is chalked over it in letters a foot high: SLAKE WATER: BOTH BEDS, TWICE.'],
  // The Kiln.
  ['furn_thorn_wheel', 'zone_thorn_kiln', 'the wheel', 'furniture',
   'A kick wheel worn hollow on the near side. Every bowl in the Thornwarren came off it, and every one has a thumbprint pressed into the foot ring, and they are all the same thumbprint.'],
  ['furn_thorn_jars', 'zone_thorn_kiln', 'a stack of red jars', 'furniture',
   'Glazed deep red and much better work than the tableware beside them, thicker in the shoulder than they look. Nine a month, six survive the firing, eleven hundred going back to before the potter was born.\n\nThey are not for the table.'],
  // The Whelping Room.
  ['furn_thorn_shelves', 'zone_thorn_whelp', 'the small shelves', 'furniture',
   'A wall of them at knee height, each with a name chalked on it. Chalk rather than paint, and nobody in the building will tell you why, and everybody in the building knows.'],
  ['furn_thorn_numbers', 'zone_thorn_whelp', 'the numbers by the door', 'furniture',
   'How many they lose. Written up plainly with no comment attached, because pretending would be worse.\n\nUnderneath, in a different hand, a very much longer list of the ones who came through, and somebody has underlined the length of it.'],
  // The Houndyard.
  ['furn_thorn_collars', 'zone_thorn_hounds', 'the collar pegs', 'furniture',
   'Sixteen collars on pegs with no dogs attached to them. Every peg is labelled and every label is a name. They are oiled and checked with the working collars, on the same rota, and there is no plan to take them down.'],
  // The Roofwalk.
  ['furn_thorn_gutterboard', 'zone_thorn_roofwalk', 'the gutter board', 'furniture',
   'The whole town drawn as a run of gutters, in chalk, corrected constantly, with the bad joints ringed and a name beside each ring.'],
  ['furn_thorn_rail', 'zone_thorn_roofwalk', 'the top rail', 'furniture',
   'From up here the Thornwarren is laid out below you and the wall goes round all of it and the red country goes on past the wall as far as there is anything.\n\nOn the underside of the rail, where you would only see it lying down, somebody has written small: WE BUILT THIS. It is not a boast. It is a note to whoever is up here next.'],
  // The Seed beds / Netting is open ground; the Kept's sign is the last word.
  ['furn_thorn_sign', 'zone_thorn_kept', 'the sign on the wall', 'furniture',
   'The only sentence written anywhere in the Thornwarren that could be called a creed, and it is not about evolution.\n\nNOBODY IS CARRIED OUT ALONE.'],
];

// ═════════════════════════════════════════════════════════════════════════════
// WRITE
// ═════════════════════════════════════════════════════════════════════════════

function buildNpc(d) {
  const tree = { root: { actions: [], first: d.first, options: [], text: d.text, text_by_relation: d.byRel } };
  for (const [k, v] of Object.entries(d.nodes)) {
    if (!v[1]) continue;                                     // handled by a `special` below
    tree.root.options.push(opt(v[0], k));
    tree[k] = node(v[1], [
      ...Object.entries(d.nodes).filter(([k2, v2]) => k2 !== k && v2[1]).map(([k2, v2]) => opt(v2[0], k2)),
      opt('Nothing.', 'bye'),
    ]);
  }
  tree.root.options.push(opt('Nothing.', 'bye'));
  tree.bye = node('"Right."\n\nAnd they go back to it, which out here is the whole of a goodbye.');
  return npc({
    id: d.id, name: d.name, sex: d.sex, home_zone: d.zone, description: d.desc,
    chitchat: d.chitchat, dialogue_tree: tree, hp: d.hp ?? 30, hp_max: d.hp ?? 30,
    flags: { clothing_layers: d.clothing, personality: d.personality },
    vendor_inventory: (d.stock || []).map(([item_id, price]) => ({ item_id, min_trust: 0, price })),
    vendor_shop_name: d.shop || null,
    vendor_stock_size: d.stock ? d.stock.length : 10,
  });
}

let n = 0;
for (const d of PEOPLE) {
  const p = buildNpc(d);
  // ── THE TOLL, and the way in ─────────────────────────────────────────────
  //
  // Quarrel Nine is the only door. The rest of the arc (wild_seen -> wild_proving -> the Pool) was
  // already built and lives INSIDE the wall, so this sits in front of it rather than replacing any
  // of it: one errand a stranger can do without being let in, and then one question.
  //
  // The question is the commitment, and it moves the ordinary ideology axes through the ordinary
  // actions. There is no Wildblood membership flag doing the real work behind them.
  if (d.special === 'quarrel') {
    p.dialogue_tree.root.options.splice(3, 0,
      opt('Is there anything I could do?', 'toll', { conditions: [{ flag: TOLL, op: 'unset' }] }),
      opt('I brought the hound back.', 'toll_done',
        { conditions: [{ flag: TOLL, op: 'set' }, { flag: ADMITTED, op: 'unset' }] }));
    p.dialogue_tree.toll = node(
      'She looks at you for a long moment, and something in it changes, and it is not warmth. It is that she has decided to stop being professional at you.\n\n"All right. Yes. There is."\n\nShe points west with her chin, out over the flats.\n\n"One of Bracken\'s bitches went out four days ago and has not come back and she is heavy in whelp. He has been out three nights and he is fifty-one and he will kill himself doing it and he will not stop. Go and find her and bring her in."\n\n"She will not come to you. Just find her and stay with her and she will follow you when she has decided about you. It will take as long as it takes."\n\nA pause.\n\n"And no, this is not a test, and no, I am not going to let you in for it. I am asking because I have got a gate to stand at and you have got legs."',
      [opt('All right.', 'toll_take', { actions: [{ action: 'START_QUEST', quest_id: 'quest_thorn_toll' }] }),
       opt('Not my problem.', 'toll_no')]);
    p.dialogue_tree.toll_take = node(
      '"West and south. Past the Rise, keep off the high ground, you will hear her before you see her."\n\nShe goes back to watching the road, and then, without turning round: "Take water. Two. One of them is not for you."',
      [opt('Right.', 'bye')]);
    p.dialogue_tree.toll_no = node(
      '"Fair enough."\n\nAnd she means it, entirely, and goes back to watching the road, and the conversation is over in a way that leaves nothing at all to push against.',
      [opt('Right.', 'bye')]);
    // The question. Answering it one particular way is the only commitment in the chain.
    p.dialogue_tree.toll_done = node(
      'Bracken Hale came down the road at a run, which at fifty-one he should not have done, and took the animal off you without a word, and has not come back out.\n\nQuarrel Nine watched all of it from the gate and has not said anything for some time.\n\n"Right," she says eventually. "I am going to ask you one thing and then I am going to do something about it, and I want you to actually think, because people say the easy answer here and then they are inside and it is a problem for everybody."\n\nShe turns round and looks down at you.\n\n"What are you going to do with your body?"',
      [
        opt('Whatever it turns out I need it to be.', 'in', {
          actions: [
            { action: 'ADJUST_PATH', delta: 45, path: 'flesh' },
            { action: 'ADJUST_STANCE', delta: -25 },
            { action: 'ADJUST_REPUTATION', delta: 90, ideology_id: WILD, reason: 'The Toll' },
            { action: 'SET_FLAG', flag: ADMITTED, scope: 'player', value: 'yes' },
          ],
        }),
        opt('Keep it exactly as it is.', 'out'),
        opt('Improve it. Properly. With hardware.', 'out'),
      ]);
    p.dialogue_tree.in = node(
      'She nods once, and does not congratulate you, and does not smile.\n\n"Good enough."\n\nAnd she puts her long hand flat against the thorn, and the thorn draws back off the frame, all along its length, without hurrying and without any sound worth the word, and stays back.\n\n"Gate is open to you. Eat at the Fire, the food is free and you will feel strange about that for a fortnight. Do not go in the Fleshery. Do not touch a rack in the Milkhouse. Everything else in there you can walk into and somebody will tell you what it is."\n\nShe turns back to the road.\n\n"And when they ask you what you were before, tell them. They will not care and you will not believe that until it has happened about four times."',
      [opt('Right.', 'bye')]);
    p.dialogue_tree.out = node(
      '"Right."\n\nShe does not look disappointed. She looks like somebody who has just had a question answered honestly and is filing it.\n\n"That is a real answer and I would rather have it than the other thing. Bracken owes you and Bracken pays, so you will not go short out here."\n\nShe settles back against the frame.\n\n"But no. Not through here. Ask me again if that ever changes."',
      [opt('Right.', 'bye')]);
  }
  write('npcs', p.id, p);
  n++;
}

// ── The guards ───────────────────────────────────────────────────────────────
const BODY = [
  { part: 'head', soak: {}, weight: 10 },
  { grants: { component: 1 }, part: 'torso', soak: {}, weight: 40 },
  { grants: { component: 0 }, part: 'left_arm', soak: {}, weight: 12 },
  { grants: { component: 0 }, part: 'right_arm', soak: {}, weight: 12 },
  { part: 'left_leg', soak: {}, weight: 13 },
  { part: 'right_leg', soak: {}, weight: 13 },
];
// An enemy with ONE weapon must not have a body part that grants a weapon component, or the
// linter is right: the part roll could take its only attack away and leave a thing that cannot be
// killed by it and cannot fight. The two-weapon guards keep the ordinary layout.
const SINGLE_WEAPON_BODY = BODY.map(p => (p.part === 'torso' ? { part: 'torso', soak: {}, weight: 40 } : p));
let g = 0;
for (const e of GUARDS) {
  write('enemies', e.id, {
    // ⚠ NOT 'aggressive' and NOT 'territorial', and no behaviour_graph. See the note above the
    // GUARDS table: those two strings are the entire aggro test in gameLoop.js, so this stands in
    // the road and watches you go by, forever, and only fights if you start it.
    behavior: 'sentinel', behaviour_graph: {},
    body_parts: e.weapon.length > 1 ? BODY : SINGLE_WEAPON_BODY, butcher_difficulty: 8, butcher_table: [],
    death_message: e.death, description: e.desc, dodge: e.dodge,
    faction: WILD,
    flags: { attacks_npcs: false, battle_cries: e.cries, first_strike_delay_ms: 0 },
    hit: e.hit, hp_max: e.hp, id: e.id,
    loot_table: e.loot.map(([item, lo, hi, weight]) => ({ item, qty: [lo, hi], weight })),
    name: e.name, weapon: e.weapon,
  });
  g++;
}
let sp = 0;
for (const [zone_id, enemy_id, max_count] of GUARD_POSTS) {
  const sid = `zs_thorn_${enemy_id.replace('enemy_thorn_', '')}_${zone_id.replace('zone_scw_', '')}`;
  write('zone_spawns', sid, {
    enemy_id, id: sid, max_count, respawn_seconds: 1800, spawn_weight: 100, zone_id,
  });
  sp++;
}

let fn = 0;
for (const [fid, zone_id, name, object_type, description] of FURNITURE) {
  write('furniture', fid, {
    description, flags: {}, hp: null, hp_max: null, id: fid, light_type: null,
    lumen_output: null, name, object_type, power_draw_kw: null, price: 0, zone_id,
  });
  fn++;
}

// ── The things ───────────────────────────────────────────────────────────────
let it = 0;
for (const [id, name, value, weight, type, description, tags] of ITEMS) {
  write('items', id, { description, flags: {}, id, name, tags: { description, ...tags }, type, value, weight });
  it++;
}
let rc = 0;
for (const [id, name, category, skill_id, req, diff, description, ingredients, out] of RECIPES) {
  write('recipes', id, {
    base_difficulty: diff, base_output: { item_id: out[0], quantity: out[1] },
    category, description, id, name,
    ingredients: ingredients.map(([item_id, quantity]) => ({ item_id, quantity })),
    requires_station: null, skill_id, skill_req: { [skill_id]: req },
  });
  rc++;
}

// ── The toll ─────────────────────────────────────────────────────────────────
write('quests', 'quest_thorn_toll', {
  category: null,
  description: 'One of Bracken Hale\'s hounds went out onto the flats four days ago and did not come back, and she is heavy in whelp. He has been out three nights looking and he is fifty-one and he will not stop. Quarrel Nine asked you to go and find her, and was extremely clear that this is not a test and buys you nothing, and asked anyway.\n\nShe will not come to you. Find her, stay with her, and she will follow when she has decided about you.',
  fail_on: [], id: 'quest_thorn_toll', meta: {}, name: 'The Toll',
  objectives: [
    { desc: 'Search the flats west and south of the Thornwarren.',
      emotes: ['{who} works the low ground with the wall at their back, quartering it properly.'],
      id: 'o_flats', type: 'visit', zone: 'zone_scw_1033_988' },
    { desc: 'Find the hound in the dry ground below the Slake.',
      emotes: ['{who} stops moving, and sits down in the dirt, and waits, which is the only thing that was ever going to work.'],
      id: 'o_found', type: 'visit', zone: 'zone_scw_1031_982' },
    { desc: 'Walk her back to the North Gate.',
      emotes: ['{who} comes up the trophy road at a walking pace with something enormous following four feet behind them.'],
      id: 'o_home', type: 'visit', zone: 'zone_scw_1046_967' },
  ],
  penalties: {}, quest_type: 'standard', repeatable: 0,
  rewards: { credits: 140, flags: [{ flag: TOLL, scope: 'player', value: 'done' }], items: [], xp: 34 },
  updated_at: '1787000000',
});

// ── The gates ────────────────────────────────────────────────────────────────
//
// The doors sit on the seam BETWEEN the gate tile and the first tile inside, never on the approach:
// `quest_wild_seen` sends the player to stand on `zone_scw_1046_968` and that has to keep working
// for somebody who has not been let in yet. You can stand in the gateway. You cannot go through it.
let dr = 0;
for (const [cid, outside, inside, dir, did] of [
  ['conn_scw_northgate', 'zone_scw_1046_968', 'zone_scw_1046_969', 'south', 'door_thorn_northgate'],
  ['conn_scw_sallygate', 'zone_scw_1046_984', 'zone_scw_1046_983', 'north', 'door_thorn_sallygate'],
]) {
  write('connections', cid, { a: outside, b: inside, blocked: false, dir, id: cid, lockable: true, one_way: false });
  write('doors', did, {
    connection_id: cid, door_type: 'reinforced', exit_dir: dir, flags: {},
    hololock_difficulty: 0, hp: 4000, hp_max: 4000, id: did, is_locked: 1, is_open: 0,
    lock_state: 'locked', name: 'the thorn',
    // Unbreakable, and it is the one door in the game where that is a fiction rather than a rule:
    // cutting this wall is the exact thing it has been famous for surviving for thirty years.
    tags: { 'lock:thornwarrengate': {}, unbreakable: true },
    target_zone: inside, zone_id: outside,
  });
  dr++;
}

// ── Re-homing the six who already lived here ─────────────────────────────────
//
// They were standing on open ground because there was nowhere to stand. Now there is. Nothing else
// about them is touched: their prose, their dialogue and their quest wiring were hand-written and
// are better than anything this file would produce.
let moved = 0;
for (const [npcId, room] of [
  ['npc_thorn_chorus', 'zone_thorn_den'],
  ['npc_thorn_rindle', 'zone_thorn_rindles'],
  ['npc_thorn_thole', 'zone_thorn_physic'],
  ['npc_thorn_bracken', 'zone_thorn_hounds'],
  ['npc_thorn_moraine', 'zone_thorn_sweetwater'],
  ['npc_thorn_ossa', 'zone_thorn_gatehouse'],
]) {
  const j = readJson('npcs', npcId);
  if (!j) continue;
  j.home_zone = room;
  j.work_zone_id = room;
  write('npcs', npcId, j);
  moved++;
}

console.log(`thornwarren people: ${n} NPCs, ${g} guards in ${sp} posts, ${it} items, ${rc} recipes, ${fn} furniture, 1 quest, ${dr} gates, ${moved} re-homed`);
