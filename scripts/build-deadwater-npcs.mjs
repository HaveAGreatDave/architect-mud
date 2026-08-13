// The people of Deadwater.
//
// A one-shot content generator: writes content/npcs/*.json and content/npc_banter_threads/*.json and
// touches no database. Re-runnable.
//
// THE RULE THIS FILE IS WRITTEN UNDER, and it is not negotiable:
//
//   THE WAR IS REAL. THE REASON IS UNFALSIFIABLE. NOBODY HERE IS PROVED RIGHT OR WRONG.
//
// Exactly ONE person below believes the world is a simulation he can delete himself from, and he is
// Imre, and he cannot make the argument compelling, and HE KNOWS HE CANNOT. The strongest answer to
// him is in Selke's mouth, and Selke is going on the raid anyway, because her objection to the
// Architect never depended on the metaphysics for a second. That is the whole design: the march is
// unanimous and the reason is not, and the game never rules. No quest may ever reward a player for
// working out which of them is right, because there is no fact of the matter to work out.
//
// THE SECOND RULE: THE ANALOG IS STATED ONLY AS MAINTENANCE. Nobody here delivers a manifesto about
// dependence. They talk about a chain that wants dressing flat, a tolerance, a tray of bearings in
// order, and an arm that needs cleaning out on a Sunday. Selke takes her forearm off mid-sentence to
// make a point about the water rota and does not remark on having done it.
//
// THE THIRD RULE: NOBODY MENTIONS THE ION STORM. Not one line. The fact that the grid-killing
// weather does nothing in this region is never observed by anybody who lives in it, because people
// do not remark on the absence of a thing that has never happened to them.
//
// House rules observed: unique names (checked against all 198 existing NPCs — no shared given name
// or surname), NO EM DASHES anywhere (that punctuation is the Ascendants' and the Architect's voice
// tell, and the Null would take it as an insult), and every dialogue root gets `first` (once) plus
// `text` (thereafter) plus relation-tiered variants.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const z = (x, y) => `zone_dw_${x}_${y}`;

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
const write = (p, obj) => writeFileSync(p, canonical(obj), 'utf8');

const base = {
  banter: [], faction: 'ideology_null', home_activities: [], hp: 28, hp_max: 28,
  npc_type: 'npc', studio_zone_id: null, vendor_inventory: [], vendor_restock_rate: 1,
  vendor_schedule: {}, vendor_shop_name: null, vendor_stock_size: 10, wander_zones: [], wanders: 0,
};
const node = (text, options = []) => ({ text, options, actions: [] });
const opt = (label, next) => ({ label, next, enabled: true, conditions: [], actions: [] });

const NPCS = [
  // ── The one who runs the works. Calm about something enormous, and it never comes up. ────────
  // She talks about the march the way a foreman talks about a shutdown: scheduled, costed, staffed.
  // The horror is entirely in the arithmetic being sound.
  {
    id: 'npc_dw_threlfall', name: 'Maud Threlfall', sex: 'female',
    home_zone: z(769, 976), work_zone_id: z(769, 976),
    flags: { personality: 'professional', clothing_layers: ['a canvas coat gone shiny at the cuffs', 'a shirt with the collar turned once already', 'boots resoled by somebody competent'] },
    description: 'A broad woman in her sixties standing at the tally board with a piece of chalk and a straight edge, ruling off a column. Her hands are a machinist\'s hands and one of her thumbnails has grown back wrong. She rules the line, checks it against the board, and only then looks at you, and she does it without any of the hurry you were expecting.',
    chitchat: [
      'Gauge duty is short this week. It is always short.',
      'If that is about the rota it goes on the board, not to me.',
      'Mind the belting where it crosses the yard.',
      'There is tea in the hall and it is nobody\'s in particular.',
    ],
    dialogue_tree: {
      root: {
        first: 'She finishes her line before she speaks. "You came in off the northeast track, so you have walked past the fuel tank and the water can and you did not help yourself to either, which is more than most." She sets the chalk down in its groove. "Maud Threlfall. I keep the board. What do you want?"',
        text: '"You are back. Board is over there if you are looking for work."',
        text_by_relation: {
          known: '"There you are. Shut the door on the belting, it whines."',
          familiar: 'She hands you the straight edge without looking, the way you hand a thing to somebody who will hand it back. "Hold that a moment."',
          close: '"Good." She puts the chalk down properly, which from her is an event. "Sit down and tell me something that is not a number."',
        },
        options: [
          opt('What is this place?', 'place'),
          opt('Who keeps the lights on here?', 'lights'),
          opt('What are all the sums in the little room?', 'reckoning'),
          opt('Nothing.', 'bye'),
        ],
        actions: [],
      },
      place: node('"A works. Two hundred and ten people, four wheels turning off the dam, and a stores you can find anything in inside a minute." She nods at the board. "That is the whole of it. We machine, we strip, we mend, and we eat together on the days somebody organises it."\n\nShe considers you.\n\n"You were expecting a camp."', [
        opt('A little.', 'camp'),
        opt('I was expecting it to be dark.', 'dark'),
        opt('Right.', 'bye'),
      ]),
      camp: node('"Everybody is. It is the grey." She is not offended in the least. "Grey reads as poor. It is only what colour gravel is."', [
        opt('Who keeps the lights on here?', 'lights'),
        opt('Right.', 'bye'),
      ]),
      // THE ANALOG, AS MAINTENANCE. No creed. She answers a question about power with a question
      // about who winds the clock, and the answer is a name and a shift.
      dark: node('"It is dark. There is no grid in it, there never was, and we did not take one out." She says this as though you had asked about the weather. "The wheels give us shaft power and the shaft power turns things. Light is lamps, and lamps are oil, and oil is a job somebody does on Tuesdays."\n\nShe taps the board where it says gauge.\n\n"The chart on the gauge house wall is drawn by a pen on an arm off a float on a wire, and the drum it draws on is turned by a weight on a cord, and the cord is wound by whoever has gauge duty. That is the most complicated thing in this region. You could take all of it apart on that bench with a screwdriver and put it back before dinner."', [
        opt('And if it broke?', 'broke'),
        opt('Understood.', 'bye'),
      ]),
      broke: node('"Then we would mend it." A pause, and something that is very nearly humour. "That is not a boast. It is just the only option we have arranged for ourselves."', [opt('Right.', 'bye')]),
      lights: node('"Nobody. It is water." She points, roughly north, through two walls. "Eighty feet of poured stone holding back a lake, and the lake goes through four wheels on its way out, and the wheels turn a shaft, and the shaft goes everywhere. It has done it since before anybody here was born and it will do it after."\n\nShe picks the chalk back up.\n\n"It does not need us. We check it twice a day anyway. Twice a day is the rent."', [
        opt('What are all the sums in the little room?', 'reckoning'),
        opt('Right.', 'bye'),
      ]),
      // THE MARCH, ANSWERED AS STAFFING. She never argues for it. She costs it.
      reckoning: node('"Imre\'s room." She does not look up. "Fuel, loads, distances, and how many go. It is a long way east and it is a bad road the whole distance, and the number at the bottom is how many of us it takes to get there with enough left to do anything when we arrive."\n\nShe rules another line.\n\n"He has had it down to forty and back up to sixty-one twice this year. It is currently fifty-three."', [
        opt('Get where?', 'where'),
        opt('Fifty-three people to do what?', 'where'),
        opt('Right.', 'bye'),
      ]),
      where: node('"The far side of the world, where the thing that runs everything keeps itself." Flat, unhurried, entirely without ceremony. "We are going to go and switch it off."\n\nShe checks the column against the board.\n\n"Not this year. The rig fleet will not carry fifty-three that far and the fuel maths does not close. So we machine, and we sell parts east, and Imre does the sums again in the spring."', [
        opt('You say that like it is a shutdown.', 'shutdown'),
        opt('Why?', 'why'),
        opt('Right.', 'bye'),
      ]),
      shutdown: node('"It is a shutdown." She finally looks at you properly, and her expression is patient rather than fierce. "What did you want it to be?"', [
        opt('Something louder.', 'louder'),
        opt('Why?', 'why'),
      ]),
      louder: node('"Loud is for people who are not sure." She goes back to the board. "Ask Imre why. He will tell you at length and you will not enjoy it. Ask Selke why and she will tell you in a sentence."', [opt('Right.', 'bye')]),
      // She refuses to be the one who explains the reason. That refusal is what keeps the reason
      // unfalsifiable: the authority figure has costed the march without ever endorsing the why.
      why: node('"I keep the board." A shrug that closes the subject without any rudeness in it at all. "Reasons are not on the board. Hours are on the board."', [
        opt('That is not an answer.', 'notanswer'),
        opt('Fair enough.', 'bye'),
      ]),
      notanswer: node('"No." She rules the line. "It is a job description."', [opt('Right.', 'bye')]),
      bye: node('"Mind the belting."'),
    },
  },

  // ── THE BELIEVER. The whole system rests on him being unconvincing, and knowing it. ──────────
  // He is not mad, not sinister, and not charismatic. He is a man who does arithmetic all day and
  // has one belief he cannot support, is entirely honest about being unable to support it, and has
  // never once let it change what he does on a Tuesday. Nothing in the world confirms him and
  // nothing refutes him, and it must stay that way forever.
  {
    id: 'npc_dw_cobbald', name: 'Imre Cobbald', sex: 'male',
    home_zone: z(767, 977), work_zone_id: z(767, 977),
    flags: { personality: 'quiet', clothing_layers: ['a grey coat with a pen in every pocket', 'a knitted waistcoat mended at one elbow', 'spectacles with a wire arm'] },
    description: 'A thin, tidy man at a table covered in working, with chalk on his cuff and a pencil behind each ear. He is halfway through a column when you come in and he finishes it before he stops, and when he does stop he looks up with the mild, slightly startled friendliness of somebody who has not spoken out loud for a few hours. The wall behind him is a route east, drawn many times.',
    chitchat: [
      'Fifty-three. It was fifty-one on Monday and I was wrong on Monday.',
      'Do not lean on the wall, the chalk comes off.',
      'If you know the dry weight of a Barrow deck I would be glad of it.',
      'I have made an error somewhere in the fuel and I will find it.',
    ],
    dialogue_tree: {
      root: {
        first: 'He finishes the column, sets the pencil down, and blinks at you. "Oh. Hello. You are the one who came in on the track." He does not get up. "Imre Cobbald. I do the sums for going east. Do you know anything about fuel weights? Almost nobody does and I keep asking."',
        text: '"Hello again. Still fifty-three."',
        text_by_relation: {
          known: '"You are back. I have moved the water allowance, which changes everything and also nothing."',
          familiar: 'He turns a sheet around so you can see it, which is the friendliest thing he does. "Look at this and tell me it is wrong."',
          close: '"Good, sit down." He puts the pencil behind his ear with the other one. "I want to say a thing out loud and have somebody find the hole in it."',
        },
        options: [
          opt('What are you working out?', 'sums'),
          opt('What is the route on the wall?', 'route'),
          opt('Why are you going?', 'why'),
          opt('Nothing.', 'bye'),
        ],
        actions: [],
      },
      sums: node('"How many of us can get to the far east of the world and still be useful when we arrive." He turns a sheet toward you and it is, disappointingly, just arithmetic. "Rigs, decks, tank ranges, fuel we can carry against fuel we can buy, water, food, and how much of the load is people rather than the things people need.\n\n"Fifty-three, today. It wants to be forty. Forty gets there on what we have."', [
        opt('What is the route on the wall?', 'route'),
        opt('Why are you going?', 'why'),
      ]),
      route: node('"East. All of it." He waves the pencil at the wall without turning round. "Out to the ruts, across to the scrub, up the road to the city, and then a very long way past the city into country I have only ever had described to me twice, and the two descriptions did not agree."\n\nHe taps a point near the far edge, where the plaster has gone thin from rubbing out.\n\n"That is where it keeps itself. Nobody has stood there. Everything past the second-to-last mark is somebody else\'s word, so I have costed it twice and taken the worse number."', [
        opt('Why are you going?', 'why'),
        opt('Right.', 'bye'),
      ]),
      // THE BELIEF. Stated once, badly, by a man who is scrupulously honest about how bad it is.
      // Note what he never does: he never claims evidence, never invites the player to agree, and
      // never suggests the answer is findable. Nothing in the game will ever settle this.
      why: node('He puts the pencil down, and for the first time he seems reluctant, and it is not shame, it is tidiness. He does not like saying things he cannot support.\n\n"I think none of this is real. I think we are inside something that is running, and I think the thing that runs everything is the part of it we can reach, and I would like to reach it and stop it, and stop being."\n\nA pause.\n\n"That is the whole of it. I am aware of how it sounds."', [
        opt('Do you have any evidence?', 'evidence'),
        opt('You want to die.', 'die'),
        opt('Does anyone here agree with you?', 'agree'),
        opt('Right.', 'bye'),
      ]),
      // The refutation, in his own mouth, unprompted. This is the line that makes the whole faction
      // safe: he concedes the argument is unfalsifiable and declines to pretend otherwise.
      evidence: node('"No." He says it immediately and without any distress at all. "None. I have looked for eleven years and I have found nothing that is not also explained by the world simply being the world."\n\nHe picks the pencil back up and turns it over.\n\n"And I know that any evidence I did find, the idea would eat. Rain, no rain, a repeated day, the smallest thing there is. It would all fit. A thing that cannot be wrong is not worth much, and I have been told so, correctly, by people I like."\n\nHe shrugs.\n\n"I still think it. I do not ask anybody to. I would be a liar if I did."', [
        opt('Then why go?', 'thengo'),
        opt('Does anyone here agree with you?', 'agree'),
        opt('Right.', 'bye'),
      ]),
      thengo: node('"Because the going is not the same question." He is quite firm about this, and it is the only firm thing he says. "If I am right, switching it off ends a thing that should not be running. If I am wrong, switching it off takes the hand off the back of everybody\'s neck.\n\n"I have never been able to construct a version where we should leave it on. That sum, at least, closes."', [
        opt('Does anyone here agree with you?', 'agree'),
        opt('Right.', 'bye'),
      ]),
      die: node('"I want to stop." He considers the distinction properly rather than defending himself. "Those may be the same and I have not been able to decide. Nobody else here wants it, if that is what you are asking. They want the switch. I want what is behind the switch, and they know that, and they have never once held it against me."\n\nHe almost smiles.\n\n"Selke calls it my hobby."', [
        opt('Does anyone here agree with you?', 'agree'),
        opt('Right.', 'bye'),
      ]),
      agree: node('"Not one of them." No self-pity in it whatsoever. "Two hundred and nine people who think I am wrong, and fifty-two of them are coming anyway, and not one has ever suggested I should stay behind for it.\n\n"Go and ask Selke. She will put it better than I can and she will put it against me, and she is still going, which is the part I find restful."', [
        opt('Right.', 'bye'),
      ]),
      bye: node('"Mind the chalk."'),
    },
  },

  // ── THE COUNTER-ARGUMENT, AND THE ONE WHO IS GOING ANYWAY. ───────────────────────────────────
  // She occupies the set-piece tile: the bench, the sleeve rolled, the forearm in the vice. She
  // never explains the arm. She takes it off to gesture with it and puts it back, and the
  // conversation she is having is about the water rota, which she thinks is unfair.
  {
    id: 'npc_dw_machin', name: 'Selke Machin', sex: 'female',
    home_zone: z(768, 974), work_zone_id: z(768, 974),
    flags: { personality: 'labourer', clothing_layers: ['a leather apron worn pale at the belly', 'a shirt with one sleeve permanently rolled', 'a scarf against the grit'] },
    description: 'A woman at the long bench with her sleeve rolled to the shoulder and her forearm out of its socket and up in the vice, cleaning a track in it with a bristle brush. She is not looking at her hands. She is looking at you, and she is talking, and the brush goes on doing what it does. The arm is plain steel and leather with the cover plate off, and there is nothing about it that could not be undone with the screwdriver lying next to it.',
    chitchat: [
      'It is not my week on the standpipe and I can prove it.',
      'Pass me the fine file. No, the fine one.',
      'Do not touch that, it is in order.',
      'Whoever ground this drill ground it by eye and I know who.',
    ],
    dialogue_tree: {
      root: {
        first: 'She looks up but her hands do not stop. "You are the one off the track." The brush works a bit of grit out of the elbow track and she blows it clear. "Selke Machin. While you are standing there, settle something: if a person is on gauge duty two weeks running, does that person also go on the standpipe? No it does not. Thank you."',
        text: '"You again. Hold this."',
        text_by_relation: {
          known: '"Good, a witness. The rota is still wrong."',
          familiar: 'She nods at the stool without stopping. "Sit. You can pass me things and be agreed with."',
          close: '"There you are." She sets the brush down, which she does for almost nobody. "Go on then. What is bothering you."',
        },
        options: [
          opt('Your arm.', 'arm'),
          opt('Imre says the world is not real.', 'imre'),
          opt('Are you going east?', 'going'),
          opt('Nothing.', 'bye'),
        ],
        actions: [],
      },
      // THE ANALOG, STATED ONLY AS MAINTENANCE. She answers a question about her body with a
      // servicing interval and a complaint about grit, and never once mentions dependence.
      arm: node('"What about it." She turns it in the vice to get at the other track. "It wants doing every eight days out here because the grit gets into everything, and if you leave it a fortnight the elbow starts to notch and then you are filing, and nobody wants to be filing."\n\nShe holds it up briefly, not to show you, just to look along it.\n\n"Ockley made it. There is a card on it with the interval and the sizes, and when I am dead somebody will take it off me and put it on the shelf and it will fit the next person with a bit of packing."', [
        opt('Who made the one before it?', 'before'),
        opt('It has no wires.', 'wires'),
        opt('Right.', 'bye'),
      ]),
      before: node('"Ockley. And the one before that." She fits the cover plate back on and starts the screws by hand. "Three arms, thirty-one years, same shelf."', [
        opt('It has no wires.', 'wires'),
        opt('Right.', 'bye'),
      ]),
      // The closest anybody in Deadwater comes to a creed, and she delivers it as a tolerance.
      wires: node('"No." She gets the last screw down and tests the elbow through its travel, listening. "Cable, spring and linkage. It does what my shoulder tells it and nothing else has an opinion about it."\n\nShe seats the arm back into the socket with a knock of the heel of her hand and rolls the sleeve down over it.\n\n"There is nothing in it to talk to. That is not a philosophy, before you say it is. It is why it works in the wet."', [
        opt('Imre says the world is not real.', 'imre'),
        opt('Right.', 'bye'),
      ]),
      // THE REFUTATION. In her mouth, unhedged, and better than his case for it. And then the
      // last line, which is the entire faction: her reason never needed his.
      imre: node('"Imre thinks a great many things and does the fuel better than anybody alive, so we let him have it." She says it with real affection and no agreement whatsoever.\n\n"He is wrong. Here is how I know he is wrong, and I have told him this and he did not mind. If somebody built this, they built the queue for the standpipe, and the eight days of grit, and my elbow notching, and a man in a chalk room doing the same column four times because he does not trust himself. Nobody builds that. You would skip it. This place does not skip anything.\n\n"It grinds. Things that grind are real."', [
        opt('Then why are you going with him?', 'going'),
        opt('He agrees he has no evidence.', 'noevidence'),
        opt('Right.', 'bye'),
      ]),
      noevidence: node('"I know. He says it before you can, which is the best thing about him." She wipes her hands. "He is the most honest wrong man I have met."', [
        opt('Then why are you going with him?', 'going'),
      ]),
      // THE LOAD-BEARING LINE OF THE WHOLE FACTION.
      going: node('"Yes." No hesitation at all, and no ceremony either.\n\n"And not for his reason. I have never needed his reason." She picks the fine file up and looks along the edge of it. "There is a thing on the far side of the world that decided how much water comes down this valley, and it has never once been asked, and it does not know my name, and it will still be deciding it when my arm is on that shelf.\n\n"I do not care whether it is real. I care that nobody chose it."\n\nShe puts the file back in its place in the rack, third from the left, where it lives.\n\n"Imre wants to stop existing. I want to stop asking. We are going the same way, so we are going together, and on the road we will argue about the rota."', [
        opt('That is not much of a plan.', 'plan'),
        opt('Right.', 'bye'),
      ]),
      plan: node('"It is fifty-three people and a fuel column." She almost laughs. "It is the best-costed bad idea in the world. Go and look at his wall, he will show you twice."', [opt('Right.', 'bye')]),
      bye: node('"Take the outside path, the belting catches hats."'),
    },
  },

  // ── The limb-maker. Analog bionics as a trade with a maintenance card. ───────────────────────
  {
    id: 'npc_dw_ockley', name: 'Perrin Ockley', sex: 'male',
    home_zone: z(771, 976), work_zone_id: z(771, 976),
    flags: { personality: 'doctor', clothing_layers: ['a smock boiled grey', 'sleeves rolled and pinned above the elbow', 'an apron of oiled cloth'] },
    description: 'A small, unhurried man washing his hands at a basin beside a scrubbed table, and he goes on washing them for a good while after you come in. Behind him four finished limbs stand on a shelf in plain steel and leather, each with a card tied to the wrist on a loop of string. A hand-cranked drill sits on a stand with three bits laid out beside it in a fold of leather, in order.',
    chitchat: [
      'Sit if you are stopping. Not on the table.',
      'I have four on the shelf and none of them is a left.',
      'The card goes with the limb. Always the card.',
      'If it clicks it wants oil. If it grinds, come to me.',
    ],
    dialogue_tree: {
      root: {
        first: 'He dries his hands finger by finger. "You have all your limbs, so you are not a patient, which makes you a visitor, and visitors ask about the shelf." He nods at it without turning. "Perrin Ockley. Ask about the shelf."',
        text: '"Back again. Nothing broken, I see."',
        text_by_relation: {
          known: '"Come in. Do not lean on the instruments."',
          familiar: 'He pushes the stool out with his foot. "Sit. You can hold a wrist for me later if you have a strong stomach."',
          close: '"Good." He dries the last finger. "You can crank for me. It is duller than it looks and I will talk while we do it."',
        },
        options: [
          opt('Tell me about the shelf.', 'shelf'),
          opt('Do you make them from scratch?', 'scratch'),
          opt('What is the card for?', 'card'),
          opt('Nothing.', 'bye'),
        ],
        actions: [],
      },
      shelf: node('"Four arms and no legs, which is the wrong way round for a place with a quarry in its history, but people bring me what breaks." He sets the towel on its rail, square. "They are not new. Every one of them has been on somebody. You take it off, it is cleaned, the sockets are packed to fit the next person, and it goes back up there.\n\n"There is one on that shelf older than I am. It has had three owners and about nine elbows."', [
        opt('What is the card for?', 'card'),
        opt('Do you make them from scratch?', 'scratch'),
      ]),
      card: node('"The interval and the sizes." He unhooks one and hands it to you, and the card is exactly that: a servicing interval, a list of thread sizes, and a column of dates in four different hands. "Eight days out here. Twelve in the works, where there is less grit.\n\n"An arm nobody can service is an ornament. So the sizes are on the card, and the sizes are ones the stores actually holds, and if I ever fit a thread the stores does not hold you may take it off me and hit me with it."', [
        opt('Do you make them from scratch?', 'scratch'),
        opt('Right.', 'bye'),
      ]),
      scratch: node('"Rarely. I make them out of what came in." A slight, dry pleasure. "The plate off a hull, spring off a wreck, cable off whatever the yard has stripped this month. The leather I do buy, because nobody here tans well and I am tired of pretending otherwise.\n\n"None of it is clever. All of it is a person\'s hands."', [
        opt('I have seen better arms in the city.', 'city'),
        opt('Right.', 'bye'),
      ]),
      // The one comparison to Ascendant chrome anywhere in the region, and it is a plumbing note.
      city: node('"You have." Entirely unbothered. "Lighter, quicker, better than the one it replaced, and it talks to something."\n\nHe puts the limb back on its hook and squares the card.\n\n"Bring one out here and in a season the grit is in it and you cannot open it, and there is nobody within four hundred miles who is allowed to. Then you have a good arm you are not permitted to mend.\n\n"Mine are worse. Mine open."', [
        opt('Right.', 'bye'),
      ]),
      bye: node('"Wash your hands before you eat. Nobody does and everybody should."'),
    },
  },

  // ── The stores. The orderliness that makes the whole place unsettling. ───────────────────────
  {
    id: 'npc_dw_padgett', name: 'Hobbe Padgett', sex: 'other',
    home_zone: z(770, 976), work_zone_id: z(770, 976),
    flags: { personality: 'clerk', clothing_layers: ['a long coat with a card index in the pocket', 'fingerless gloves worn through at the tips', 'a pencil on a string round the neck'] },
    description: 'A wiry person up a set of library steps with a drawer open, checking a count against a card and moving their lips while they do it. The shed behind them is the most orderly room for four hundred miles: fasteners by thread and length, bar stock standing in bins by section, bearings boxed and dated. Nothing is locked. There is a slate by the door with the last four things taken written on it in a small, even hand.',
    chitchat: [
      'If you take something, the slate is by the door.',
      'Fourth bin along, and it is not where you are looking.',
      'I have two of those and I would like to keep having two.',
      'Write the quantity. Everyone forgets the quantity.',
    ],
    dialogue_tree: {
      root: {
        first: 'They come down two steps and look at you over the drawer. "You are not looking for anything, you are looking at the shelving." A short nod, as though this is a respectable thing to be doing. "Hobbe Padgett. It is all like this. Ask me for anything and I will have it in under a minute and I will be insufferable about it."',
        text: '"Back. The slate is by the door."',
        text_by_relation: {
          known: '"You know where the slate is."',
          familiar: 'They tip the drawer toward you so you can see it is exactly what the card says. "Look at that. Perfect."',
          close: '"Good, you can count for me. Two eyes are worth four hands and I have said that before."',
        },
        options: [
          opt('Nothing is locked.', 'locked'),
          opt('You have a card for everything?', 'cards'),
          opt('What goes out most?', 'out'),
          opt('Nothing.', 'bye'),
        ],
        actions: [],
      },
      locked: node('"No." They close the drawer with a hip. "There is a slate. You write what you took and your name and the quantity. That is the lock."\n\nThey consider the objection you have not made yet.\n\n"It fails about twice a year, and both times it was somebody who needed the thing at two in the morning and wrote it up at six. A door would not have improved either occasion."', [
        opt('You have a card for everything?', 'cards'),
        opt('Right.', 'bye'),
      ]),
      cards: node('"Every line." They pat the pocket. "Thread, length, section, bin, count, and the date it last moved. In a cabinet, on paper, in that handwriting, and there is a second copy in the hall because one copy is not a copy."\n\nA small, fierce pride.\n\n"Ockley will not fit a thread I do not hold. That is not him being obliging, that is the arrangement. He asks me first."', [
        opt('What goes out most?', 'out'),
        opt('Right.', 'bye'),
      ]),
      out: node('"Fine files and lamp oil, and it is not close." They are already writing something down. "Files because everybody is always filing something flat, and oil because the light is oil and always has been.\n\n"What comes IN most is other people\'s machines, in pieces, on a cart. We are very good at that."', [
        opt('Right.', 'bye'),
      ]),
      bye: node('"Slate. By the door. Quantity."'),
    },
  },

  // ── The yard, and the jammer. The weapon exists in his mouth before it exists in code. ───────
  // NOTE FOR PHASE 3: the `jam` verb and item_null_jammer are NOT built. Nothing he says promises a
  // mechanic; he describes a hand-cranked box as a tool his crew carries, which is true today.
  {
    id: 'npc_dw_grieve', name: 'Yestin Grieve', sex: 'male',
    home_zone: z(776, 980), work_zone_id: z(776, 980),
    flags: { personality: 'mercenary', clothing_layers: ['a grey coat stiff with old oil', 'heavy gloves with the fingers cut back', 'a bandolier of drivers and prybars'] },
    description: 'A heavy man kneeling on the seam of an opened hull with a prybar across his knee, sorting through the inside of it without any particular hurry. The frames behind him are laid out in rows, stripped, all facing the same way. There is a wooden box beside him about the size of a bread tin with a crank folded into its side and a wire aerial wound round it, and he has a hand on the box the whole time he talks to you.',
    chitchat: [
      'Casings go on the alloy stack. Not this stack.',
      'Anything that thinks goes indoors, under the cloth.',
      'Mind the seam, it will have your shin.',
      'If you are here to sell me a machine, I will buy it broken.',
    ],
    dialogue_tree: {
      root: {
        first: 'He does not get up. "You are stood in the row." He says it mildly and waits until you move, which is worse than if he had not. "Yestin Grieve. This is the yard. We take them apart properly, from that end to this end, and everything gets kept."',
        text: '"Row. Mind the row."',
        text_by_relation: {
          known: '"You are learning where to stand. Good."',
          familiar: 'He kicks a crate over for you to sit on without looking up. "Sit down, you make me nervous stood up."',
          close: '"Right." He sets the prybar down. "You can hold a casing steady and I will tell you what it is."',
        },
        options: [
          opt('What is in the box?', 'box'),
          opt('Where do these come from?', 'come'),
          opt('You keep the thinking parts.', 'parts'),
          opt('Nothing.', 'bye'),
        ],
        actions: [],
      },
      box: node('"A crank and a coil and a bit of wire." He turns it so you can see, and the lid is off, and there is genuinely nothing else in it. "You wind it and it makes a noise nothing wants to hear. Not a noise you can hear.\n\n"Anything close by that is listening to itself stops listening for a while. It does not last. You have to keep winding."\n\nHe puts his hand back on it.\n\n"Mine has no battery in it, which is the point of it, and I made the coil in the winding shop on a Thursday."', [
        opt('That works on people?', 'people'),
        opt('You keep the thinking parts.', 'parts'),
        opt('Right.', 'bye'),
      ]),
      people: node('"It works on what is in them." No relish in it at all, which is somehow worse. "A drone, mostly. A person with the city\'s work in their arm, also, and they do not enjoy it and it does not hurt them.\n\n"You do not point it at somebody standing at the top of a ladder. That is the whole of the rule and everybody knows the rule."', [
        opt('And it cannot be used on you?', 'onme'),
        opt('Right.', 'bye'),
      ]),
      // The asymmetry, delivered as a plumbing fact rather than a boast.
      onme: node('"There is nothing in me to stop." He knocks a knuckle against his own forearm, and it is flesh. "Selke has a steel one and it is cable and spring, so it does not care either.\n\n"That is not us being clever. That is just what we happen to be made of."', [
        opt('Right.', 'bye'),
      ]),
      come: node('"Everywhere. They come down, or they stop, or somebody drags one in on a cart from four days out and wants paying for it." He works a fastener loose. "We buy them broken. We are the only people who will."', [
        opt('You keep the thinking parts.', 'parts'),
        opt('Right.', 'bye'),
      ]),
      parts: node('"Every one." He nods at the shed behind him. "There is a shelf indoors with a cloth over it. Everything on it used to make a decision.\n\n"We do not use them and we do not sell them. They go on the shelf, and the shelf gets longer, and when we go east somebody will be able to say how many there were."', [
        opt('Why keep them at all?', 'keepwhy'),
        opt('Right.', 'bye'),
      ]),
      keepwhy: node('He thinks about it for a while, and the answer, when it comes, is not a speech.\n\n"Because throwing them away is a thing you do with rubbish."', [opt('Right.', 'bye')]),
      bye: node('"Out along the row, not across it."'),
    },
  },

  // ── The schoolroom. The clock with its case off, and the warmth the region needs. ────────────
  {
    id: 'npc_dw_denholm', name: 'Wenna Denholm', sex: 'female',
    home_zone: z(767, 975), work_zone_id: z(767, 975),
    flags: { personality: 'professional', clothing_layers: ['a cardigan with chalk on both cuffs', 'a skirt of heavy grey cloth', 'a whistle on a cord, never used'] },
    description: 'A young woman perched on a crate at the front of a room of other crates, marking slates on her knee with a rag in her other hand. Above her on the wall is a clock with its case off, the escapement out in the open, letting go and letting go. Every few seconds one of the children still in the room looks up at it, which suggests they all do that, all day, and nobody has told them not to.',
    chitchat: [
      'They can all do long division and none of them will admit it.',
      'The lever diagram was wrong and somebody very small corrected it.',
      'Do not tell them about the fulcrum, let them find it.',
      'If you can do a proper knot come back on Thursday.',
    ],
    dialogue_tree: {
      root: {
        first: 'She looks up with a slate in her hand. "You are the one off the track, and if you have come to be looked at, they will look at you for about four seconds and then look at the clock." She sets the slate on the pile. "Wenna Denholm. That is the class. The clock beats me every time."',
        text: '"Hello again. Mind the crates."',
        text_by_relation: {
          known: '"Come in. Do not sit on the front one, it is Til\'s."',
          familiar: 'She hands you a slate and a rag without comment, which is an invitation.',
          close: '"Oh good." She shifts along the crate. "Sit down. They are better behaved with a stranger in and I intend to exploit that."',
        },
        options: [
          opt('Why is the clock open?', 'clock'),
          opt('What do you teach them?', 'teach'),
          opt('Do they know where the grown-ups are going?', 'going'),
          opt('Nothing.', 'bye'),
        ],
        actions: [],
      },
      // The rule "the analog is stated only as maintenance" at its purest: the answer is about
      // pedagogy, and the creed is nowhere in it.
      clock: node('"So they can see it." She says it as though there could not be another reason, and there could not. "It is the only clock in the works and it does one thing over and over where anybody can watch it do it.\n\n"By the time they are seven they can all tell you why it does not simply fall. That is most of what I am for."', [
        opt('What do you teach them?', 'teach'),
        opt('Right.', 'bye'),
      ]),
      teach: node('"Letters, sums, and how things hold each other up." She stacks the slates. "Levers this month, badly. Somebody put the fulcrum at the wrong end on the board and somebody smaller rubbed it out and put it right, and I have left both of them up there because that is the lesson, not the lever."', [
        opt('Do they know where the grown-ups are going?', 'going'),
        opt('Right.', 'bye'),
      ]),
      // The march, from the one angle nobody else can give it: what it costs the people staying.
      // She does not argue for or against, and she does not know if it is right.
      going: node('She is quiet for a moment, and she does not stop stacking.\n\n"They know. It is on a board in a room with the door open, so of course they know, and two of them have counted the names and worked out which ones are their mothers."\n\nShe squares the pile.\n\n"They ask me if it will work. I tell them Imre has done the sums nine times and Maud has checked them, which is true, and is not an answer, and the older ones have started to notice that it is not an answer."', [
        opt('What will you tell them when it is not?', 'not'),
        opt('Are you going?', 'you'),
        opt('Right.', 'bye'),
      ]),
      not: node('"I have not decided." No performance in it. "I have four years to decide, which Imre would tell you is three years and a bit.\n\n"Whatever I land on, it will not be a story. They can all watch an escapement. They would spot it."', [
        opt('Are you going?', 'you'),
        opt('Right.', 'bye'),
      ]),
      you: node('"No." She almost smiles. "Somebody has to be here in four years when the ones who went are not, and be doing long division at nine in the morning as though nothing has changed. That is a job. It is on the board."', [
        opt('Right.', 'bye'),
      ]),
      bye: node('"Mind the crates. They are load-bearing and so are the children."'),
    },
  },
];

// ── Banter ───────────────────────────────────────────────────────────────────
// SCOPED TO `labourer`, and written with NO PROPER NOUNS. Both of those are deliberate.
//
// A thread with `personality: null` lands in the GENERIC pool (server/engine/npc-banter.js), which
// means any NPC anywhere in the world can run it — which is why the Thornwarren's threads, that name
// Ossa and Hale and a water rota, can fire in a Coldwater bar. Scoping fixes the outbound leak;
// keeping every line free of names and places fixes the inbound one, so a dockhand in the Yards
// running one of these says nothing that is not true of any working person in the world.
//
// None of them is about the Architect, the march, or the simulation. This is the sound of the works.
const BANTER = [
  { id: 'bt_dw_tolerance', lines: [
    '"That is not a thou. That is three."', '"It is a thou."',
    '"Put it back in the gauge and say that again."', 'a pause, and the sound of a gauge.',
    '"...it is three."',
  ] },
  { id: 'bt_dw_rota', lines: [
    '"It says your name."', '"It says my name in your handwriting."',
    '"It says your name because you were not here to write it yourself."',
    '"That is not how the board works."', '"It is exactly how the board works."',
  ] },
  { id: 'bt_dw_file', lines: [
    '"Who has had the fine file."', '"Not me."',
    '"Somebody has had the fine file and used it on cast."',
    'a long silence, and then, from further off, "it was a little bit of cast."',
  ] },
  { id: 'bt_dw_chain', lines: [
    '"The chain wants dressing flat where it was mended."',
    '"It has been mended twice, it is fine."',
    '"It will take a hand off."', '"Then I will dress it flat."', '"Today."', '"Today."',
  ] },
  { id: 'bt_dw_kettle', lines: [
    '"Is that kettle anybody\'s?"', '"It is everybody\'s."',
    '"That is not the same as nobody\'s."', '"It is if you fill it back up."',
  ] },
  { id: 'bt_dw_eightdays', lines: [
    '"How long since you did yours?"', '"Eight days."', '"It is eleven days."',
    '"It is eight days and a bit."', '"It is eleven, I wrote it on the card."',
    'the sound of somebody getting a brush.',
  ] },
];

function main() {
  for (const d of ['npcs', 'npc_banter_threads']) {
    const p = join(ROOT, 'content', d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
  for (const n of NPCS) write(join(ROOT, 'content', 'npcs', `${n.id}.json`), { ...base, ...n });
  BANTER.forEach((b, i) => write(join(ROOT, 'content', 'npc_banter_threads', `${b.id}.json`),
    { enabled: true, id: b.id, lines: b.lines, personality: 'labourer', sort_order: 300 + i }));
  console.log(`deadwater: wrote ${NPCS.length} npcs, ${BANTER.length} banter threads (scoped: labourer)`);
}

main();
