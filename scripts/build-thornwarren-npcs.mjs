// The people of the Thornwarren.
//
// A one-shot content generator: writes content/npcs/*.json and content/npc_banter_threads/*.json and
// touches no database. Re-runnable.
//
// THE RULE THIS FILE IS WRITTEN UNDER, and it is not negotiable:
//
//   NOBODY HERE EVER SAYS THEY ARE NOT MONSTERS.
//
// Not one line below argues the point, defends the town, explains the masks, or invites the player to
// revise their opinion. The revision is the player's own work or it does not happen. What these six
// talk about instead is water rota, a dog's ears, whose turn it is on the roof, and a boy who wants a
// different job. They are busy. You are, at best, mildly interesting.
//
// The two people who come CLOSEST to naming it are the two who have to: Ossa, who wears the mask and
// hates it, and the Chorus, who decided the town would wear it. Even they only ever discuss it as
// WORK. Nobody is wounded about it on screen. A community that spends its day being hurt is a
// community defined by the people hurting it, and that is exactly the story this town is not.
//
// House rules observed: unique names (checked against all 192 existing NPCs), NO EM DASHES anywhere
// (that punctuation is the Ascendants' and the Architect's voice tell), and every dialogue root gets
// `first` (once) plus `text` (thereafter) plus relation-tiered variants, so an NPC with no authoring
// still behaves exactly as before.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const CX = 1046, CY = 976;
const z = (x, y) => `zone_scw_${x}_${y}`;

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

// Defaults every NPC row needs. Spelled out once rather than repeated six times.
const base = {
  banter: [], faction: 'ideology_wildblood', home_activities: [], hp: 26, hp_max: 26,
  npc_type: 'npc', studio_zone_id: null, vendor_inventory: [], vendor_restock_rate: 1,
  vendor_schedule: {}, vendor_shop_name: null, vendor_stock_size: 10, wander_zones: [], wanders: 0,
};
const node = (text, options = []) => ({ text, options, actions: [] });
const opt = (label, next) => ({ label, next, enabled: true, conditions: [], actions: [] });

const NPCS = [
  // ── The elder. The one who decided the town would frighten people for a living. ──────────────
  // She talks about it the way a foreman talks about a night shift: a cost, borne, reviewed
  // annually. No grievance, no speech. The grievance would let the player off.
  {
    id: 'npc_thorn_chorus', name: 'The Chorus', sex: 'other',
    home_zone: z(CX, CY + 1), work_zone_id: z(CX, CY + 1),
    flags: { personality: 'cult_member', clothing_layers: ['a coat of layered hide, mended in nine colours', 'a shirt gone soft with washing', 'a great many rings, none of them matching'] },
    description: 'An old woman in a good chair, holding court over a room full of cushions with the total authority of somebody who has already won every argument in it once. When she speaks the words come doubled and a half-beat apart, as though there is more than one of her getting to them, and the room has plainly stopped noticing this a very long time ago. There is a ledger open on her knee. It is a rota.',
    chitchat: [
      'Roof crew is short. It is always short.',
      'Sit down, you are in the light.',
      'If you are here about the water rota you may join the queue.',
      'Somebody has taken the good knife again.',
    ],
    dialogue_tree: {
      root: {
        first: 'She does not stop writing. "Sit, or do not, but do not hover, it makes the dogs anxious." A pause, and then she looks up, and her eyes take rather longer to arrive than her attention did. "You came up the north road. Everyone comes up the north road, and everyone arrives looking exactly like you look."',
        text: '"You are back. The chair is there."',
        text_by_relation: {
          known: '"Ah. Shut the flap, would you, the grit gets in."',
          familiar: 'She waves a hand at the cushions without looking up from the rota. "Go on, sit. I am nearly done being important."',
          close: '"There you are." She closes the ledger, which from her is a public holiday. "Tell me something that is not about water."',
        },
        options: [
          opt('The road in. The skulls.', 'road'),
          opt('What is this place?', 'place'),
          opt('Who are you?', 'who'),
          opt('Nothing.', 'bye'),
        ],
        actions: [],
      },
      // The load-bearing node. She answers a question about atrocity with a question about staffing,
      // and never once tells the player what to conclude.
      road: node('"What about it."\n\nShe says it flatly, and waits, and does not help you.\n\n"It is four hours on the poles in the wet and eight in the dry, and it is a rotten job, and it is done because it works. Nobody has come up that road with a truck and a rope in eleven years. Before it, they came twice a season."\n\nShe goes back to the ledger.\n\n"You may think what you like about it. Most do. That is rather the arrangement."', [
        opt('It works because people think you are animals.', 'animals'),
        opt('Eleven years is a long time.', 'eleven'),
        opt('Right.', 'bye'),
      ]),
      animals: node('"Yes."\n\nThe pen does not stop.\n\n"Was there a second half to that?"', [
        opt('Does it not bother you?', 'bother'),
        opt('No. I suppose not.', 'bye'),
      ]),
      // She refuses the invitation to be wounded. That refusal is the whole character.
      bother: node('She thinks about it properly, which is worse than if she had snapped.\n\n"It bothers Ossa. He is fifteen and he has to wear the thing, so it is his to be bothered by, and he is doing it very loudly, and I have not told him to stop."\n\nA shrug.\n\n"It costs me four hours a week and it has cost me no children at all. I have done the sum more than once. It comes out the same way every time, and I would be delighted to be shown a better one, and nobody has ever brought me a better one. They bring me opinions."', [
        opt('What would a better one look like?', 'better'),
        opt('Fair enough.', 'bye'),
      ]),
      better: node('"A road nobody needs to be frightened of." She turns a page. "Bring me that and I will burn the poles myself, and Ossa will help, and we will have a party about it.\n\nUntil then it is the rota. Tuesdays and Fridays. The mask is on the rack by the gate and the lining wants restitching, if you have a needle and a free afternoon."', [opt('Understood.', 'bye')]),
      eleven: node('"It is. My daughter did the last one." She says this in exactly the tone she used for the rota. "Sill will tell you about it if you get her onto the subject of the tanks, and you will get her onto the subject of the tanks, everybody does."', [
        opt('What is this place?', 'place'),
        opt('Right.', 'bye'),
      ]),
      place: node('"Three hundred and forty people, one wall, and a very good cistern." A dry look. "You were hoping for something with more howling in it."', [
        opt('A little.', 'howling'),
        opt('No.', 'bye'),
      ]),
      howling: node('"Thursdays." She turns a page. "Bring a dish."', [opt('Right.', 'bye')]),
      who: node('"They call me the Chorus. They have called me it since before it was funny, and it was never funny." The doubling in her voice settles for a moment into something almost single. "I keep the rota. That is the whole of the office. Everything else people have decided to hang off it is theirs, not mine."', [
        opt('The road in. The skulls.', 'road'),
        opt('Right.', 'bye'),
      ]),
      bye: node('"Mind the step. It is a bad step. It has always been a bad step."'),
    },
  },

  // ── The water engineer. The best engineer in the region, and the region calls her an animal. ──
  // The town's argument, in a person. She never makes it. She talks about limestone.
  {
    id: 'npc_thorn_moraine', name: 'Sill Moraine', sex: 'female',
    home_zone: z(CX, CY - 1), work_zone_id: z(CX, CY - 1),
    flags: { personality: 'scientist', clothing_layers: ['oilskins, patched at both elbows', 'a rubber apron gone chalky', 'gauntlets shoved through a belt loop'] },
    description: 'A broad woman up to the forearms in a settling tank, working a rake through a bed of crushed stone with the unhurried violence of somebody who has done it ten thousand times. There is a slate hung at her hip with today\'s numbers on it and a stub of chalk on a string. When she straightens up to look at you she does it in stages, the way a back does after twenty years of this.',
    chitchat: [
      'Do not put anything in the tanks. Anything at all.',
      'Second bed is running slow. It is always the second bed.',
      'Four and a half, this morning. That is good. That is very good.',
      'If you want a drink, cistern gate, dipper on the chain, do not put the dipper down anywhere but the hook.',
    ],
    dialogue_tree: {
      root: {
        first: '"Mind yourself, that rail is wet." She keeps raking. "If you are here to look at it, look from there. If you are here to help, there is a second rake."',
        text: '"Rail is still wet. It is always wet."',
        text_by_relation: {
          known: '"You again. Do not lean on the tank."',
          familiar: 'She hands you the slate without being asked. "Read me the second bed, my hands are filthy."',
          close: '"Good, you. Hold this." You are holding it before you have agreed to.',
        },
        options: [
          opt('What is all this?', 'what'),
          opt('The rain out there burns.', 'rain'),
          opt('Who built it?', 'built'),
          opt('Nothing.', 'bye'),
        ],
        actions: [],
      },
      what: node('"Catchment." She says it the way other people say their own name. "Every roof in the town drains to here. Rain comes off the tin, down the channels, into the first tank and sits until the heavy sits out of it. Then the beds, which are crushed limestone and burnt bone, and that is the part that does the work: acid goes in one end and it comes out the other end being nothing much at all.\n\nThen the cistern, under the cover, in the dark and the cold. Then you drink it."\n\nShe taps the slate at her hip. "Twice a day, both ends, every day. Because the day nobody tests it is the day it stops being water."', [
        opt('That is a serious piece of engineering.', 'serious'),
        opt('Who built it?', 'built'),
        opt('Right.', 'bye'),
      ]),
      // The closest this town comes to saying the thing. She does not say it. She says "we did".
      serious: node('She looks at you for slightly too long, and then something in her decides you meant it, and her whole face changes.\n\n"It is. Thank you. Come here, look at the outflow."\n\nShe is off before you can answer, talking, and you get eleven minutes on bed depth, flow rate, why the bone has to be burnt and not merely dry, the winter the second bed failed and what they drank instead, and a diagram scratched into the dust with a rake handle. She is very, very good at this.\n\n"Anyway." She stops, abruptly, slightly embarrassed. "It runs. That is the headline. It runs."', [
        opt('Who taught you?', 'taught'),
        opt('Thank you.', 'bye'),
      ]),
      taught: node('"Nobody. That is not a boast, it is a complaint." She scrapes the rake off. "There was a book, most of a book, and there was the first tank falling over twice, and there was my mother saying try it again with the stone smaller. That is the entire faculty."', [
        opt('Your mother?', 'mother'),
        opt('Right.', 'bye'),
      ]),
      mother: node('"The Chorus." A flat, fond look. "She will not have mentioned it. She never does. She thinks it would look like leaning on it."', [opt('Right.', 'bye')]),
      rain: node('"It does. Two, three days in four out here, and worse in the season." She shrugs. "So you build a roof that sheds it and a bed that eats it, and you stop it being a problem and start it being the water supply.\n\nIt is the only rain we get. It would be very stupid to waste it because it is rude."', [
        opt('That is a serious piece of engineering.', 'serious'),
        opt('Right.', 'bye'),
      ]),
      built: node('"Everybody. Over about thirty years." She nods at the stonework. "That course is older than me. That ironwork is Vane\'s, from before his hands went. The covers are mine, and the covers are the good bit, whatever anybody tells you."', [
        opt('What is all this?', 'what'),
        opt('Right.', 'bye'),
      ]),
      bye: node('"Dipper goes back on the hook. On the hook."'),
    },
  },

  // ── The trader. The economy, and the town's manners, in one counter. ──────────────────────────
  {
    id: 'npc_thorn_rindle', name: 'Rindle Ashcroft', sex: 'female',
    home_zone: z(CX - 1, CY), work_zone_id: z(CX - 1, CY),
    flags: { personality: 'travelling_vendor', clothing_layers: ['a canvas apron with eleven pockets', 'a faded shirt buttoned to the throat', 'a scarf against the grit'] },
    description: 'A small sharp woman behind a counter made from the bed of a truck, doing three things at once and losing at none of them. She has the particular expression of a shopkeeper working out what you can afford before you have finished saying hello, and no apparent intention of holding it against you.',
    chitchat: [
      'Boots at the back, smallest to largest, do not rearrange them.',
      'I will take scrap, wire, glass, and anything that is not leaking.',
      'No credit. There is a list. You are not on the list.',
      'If you want the good jerky you have to ask for the good jerky.',
    ],
    vendor_shop_name: 'Rindle\'s',
    vendor_inventory: [
      { item_id: 'item_rad_pills', min_trust: 0, price: 55 },
      { item_id: 'item_antirad_tablets', min_trust: 0, price: 90 },
      { item_id: 'item_rag_bandage', min_trust: 0, price: 12 },
      { item_id: 'item_bandage', min_trust: 0, price: 30 },
      { item_id: 'item_medkit', min_trust: 0, price: 180 },
      { item_id: 'item_beef_jerky', min_trust: 0, price: 18 },
      { item_id: 'item_bar_jerky', min_trust: 0, price: 14 },
      { item_id: 'item_scrap_metal', min_trust: 0, price: 8 },
      { item_id: 'item_rad_band', min_trust: 0, price: 120 },
      { item_id: 'item_rusty_knife', min_trust: 0, price: 25 },
    ],
    dialogue_tree: {
      root: {
        first: '"You will be wanting water, and you are not having the tank water, you are having a jar of it like everybody else." She is already reaching for one. "Rindle. This is mine. What else."',
        text: '"Back again. What."',
        text_by_relation: {
          known: '"Jar?" She is already reaching for one.',
          familiar: '"There is a pair of boots come in your size. I put them by. Do not make me regret it."',
          close: '"Sit on the crate, you look wrecked." The jar arrives without being ordered or charged for.',
        },
        options: [
          opt('Let me see what you have.', 'shop'),
          opt('The list on your till.', 'list'),
          opt('You trade with outsiders?', 'outsiders'),
          opt('Nothing.', 'bye'),
        ],
        actions: [],
      },
      shop: { ...node('"Go on then. Do not handle the glass."'), actions: [{ action: 'OPEN_SHOP', params: {} }] },
      // The card is a joke about a debt nobody intends to collect. It is also the town's whole
      // economy: eleven names, no interest, no paperwork.
      list: node('"Eleven names." She does not look at it. "It is not a debt list, it is the opposite of a debt list. It is who does not have to ask.\n\nKesh is on it because she is up to her arms in the tanks at four in the morning and does not think to eat. Vane is on it because his hands are gone. Ossa is on it because he is fifteen and eats like a fire."\n\nA shrug. "It comes back. It always comes back. Usually as something I did not want, in a quantity I cannot store."', [
        opt('Let me see what you have.', 'shop'),
        opt('Right.', 'bye'),
      ]),
      outsiders: node('"When they come. They mostly do not." A dry look. "They get as far as the poles and they have a good long think and they go home, which is the poles working exactly as intended, so I can hardly complain about it and I do, constantly.\n\nYou got past them. So either you are stupid or you are broke. Both is common."', [
        opt('Which do you think?', 'which'),
        opt('Let me see what you have.', 'shop'),
      ]),
      which: node('"I think you are still standing there talking to me instead of looking at the boots, so you are not shopping, you are gawping." She is not unkind about it. "Gawp cheaper. There is a bench."', [opt('Right.', 'bye')]),
      bye: node('"Jar goes back on the counter when you are done with it."'),
    },
  },

  // ── The physic. Gentle, ordinary, and the least frightening man in the region. ────────────────
  {
    id: 'npc_thorn_thole', name: 'Gristle Thole', sex: 'male',
    home_zone: z(CX + 1, CY), work_zone_id: z(CX + 1, CY),
    flags: { personality: 'doctor', clothing_layers: ['a smock boiled grey', 'sleeves rolled and pinned above the elbow', 'a cloth apron changed twice a day'] },
    description: 'A big stooped man with hands that shake unless he is using them, at which point they stop. He works with the tent sides rolled up and his instruments laid out in a row on a folded cloth, and he changes the water in the bucket by the door while you watch, without appearing to think about it. Somebody long ago gave him a name meant to be unkind and he has plainly worn it flat.',
    chitchat: [
      'Wash your hands. I do not care where you have been, wash them.',
      'Sit up. No, properly up.',
      'It will hurt on Thursday. Everything hurts on Thursday.',
      'Water first. It is nearly always water.',
    ],
    dialogue_tree: {
      root: {
        first: 'He is halfway through a splinter and does not look up. "One moment. Sit, do not touch the cloth." The splinter comes out. The patient is congratulated at length on their courage. Then, to you, mildly: "Right. What have you done to yourself."',
        text: '"Sit. Do not touch the cloth."',
        text_by_relation: {
          known: '"You. Have you been drinking the standing water again."',
          familiar: 'He points at the cot without looking up. "On you get. I will be a minute."',
          close: '"Ah, good." He hands you the bucket. "Change that for me, my hands are going today."',
        },
        options: [
          opt('You are a doctor.', 'doctor'),
          opt('What do people come to you with?', 'come'),
          opt('Your name.', 'name'),
          opt('Nothing.', 'bye'),
        ],
        actions: [],
      },
      doctor: node('"I am a man with a cabinet and forty years." He wipes the instrument, sets it down in its place in the row. "There is a difference and I am careful about it. I set, I stitch, I drain, I sit with people. I do not open anybody up. I did, once, when there was nobody else, and I have opinions about how that went that I will keep to myself."', [
        opt('What do people come to you with?', 'come'),
        opt('Right.', 'bye'),
      ]),
      // Deliberately the dullest list in the region. Nothing on it is exotic. That is the payload.
      come: node('"Burns, mostly. Roof crews, forge, and the rain when somebody is caught out in it without their coat, which is always the same four people and they know who they are.\n\nAfter that: backs. Teeth. Babies, in their own time and their own way. Chest, in the winter. A great deal of nothing much that people want somebody to look at, which is half of it and the useful half."\n\nHe shrugs. "It is not interesting work. It is the same work everywhere. I assume that is not what you were expecting to hear."', [
        opt('What was I expecting to hear?', 'expecting'),
        opt('No. Not really.', 'bye'),
      ]),
      // He gets ONE line about it. One. Then he changes the subject himself, because he has a
      // patient and you are not it.
      expecting: node('He looks up, and he is not angry, and that is somehow the whole of it.\n\n"I have no idea. People arrive here expecting a great many things." He turns back to the cloth, squares an instrument a quarter inch, and the subject is quietly and completely closed. "Drink at the cistern before you go back out. Not from a drum, from the cistern. The drums are for washing."', [opt('Right.', 'bye')]),
      name: node('"It is a joke that outlived the joker." He almost smiles. "I answer to it. It is shorter than the other one and my hands are not what they were, so I have stopped fighting things that do not matter."', [
        opt('You are a doctor.', 'doctor'),
        opt('Right.', 'bye'),
      ]),
      bye: node('"Water. Cistern, not a drum."'),
    },
  },

  // ── The houndmaster. The scariest thing in the town, doing ears with a rag. ───────────────────
  {
    id: 'npc_thorn_bracken', name: 'Bracken Hale', sex: 'male',
    home_zone: z(CX + 2, CY - 2), work_zone_id: z(CX + 2, CY - 2),
    flags: { personality: 'guard', clothing_layers: ['a hide coat scarred across both forearms', 'a whistle on a bootlace', 'gloves stiff with use'] },
    description: 'A heavy, quiet man going down a line of hounds with a bucket and a rag, doing ears. The hounds are enormous and scarred and they sit for him one after another without being asked twice. He watches you the entire time he is doing it, and he does not stop doing it.',
    chitchat: [
      'Do not put your hand on the wire.',
      'They are working dogs. They are not for stroking.',
      'Stand still. She is deciding.',
      'If they go quiet, that is the bit to worry about.',
    ],
    dialogue_tree: {
      root: {
        first: 'He does not stop what he is doing. "Hand off the wire." A hound has come to the front and is looking at you with total, silent attention. "She is fine. She is deciding. Let her."',
        text: '"Hand off the wire."',
        text_by_relation: {
          known: '"You are back. She remembers you. That is not nothing."',
          familiar: 'He nods you to the gate of the run, which is as close to a welcome as he does. "Come in if you are coming."',
          close: '"Take the bucket." He is already handing it over. "Left side. She likes you better than me."',
        },
        options: [
          opt('They shadowed me the whole way in.', 'shadow'),
          opt('What are they for?', 'for'),
          opt('Nothing.', 'bye'),
        ],
        actions: [],
      },
      // The hounds were under command the entire time. He says so plainly, as a fact about dogs.
      shadow: node('"They did. From the cairn." He wrings the rag out. "That is the job. They walk you in, off the road, in sight, and they do not close.\n\nIf you had gone off the track toward the beds they would have turned you back. If you had come at the gate at a run they would have had you down and held you there until somebody came. They have not bitten anybody in four years and I would rather like to keep the number."', [
        opt('They looked feral.', 'feral'),
        opt('What are they for?', 'for'),
      ]),
      feral: node('He looks at the line of them. One is asleep on its back with its legs in the air.\n\n"Do they."\n\nHe goes back to the ears.', [opt('Right.', 'bye')]),
      for: node('"Walking people in. Turning stock. Finding whoever has gone over the wall after dark, which is always Ossa and it is always the same gap and I have stopped pretending to be surprised."\n\nHe scratches the nearest one under the jaw and it leans its whole weight into him.\n\n"And this. Mostly this, if I am honest, and I would thank you not to spread that about."', [opt('Right.', 'bye')]),
      bye: node('"Off the wire on your way past."'),
    },
  },

  // ── The boy on the gate. Fifteen, furious, and the only one allowed to be angry about it. ─────
  // He carries the mask rack's whole meaning without once explaining it: it is a SHIFT, it is
  // ROTA'D, the lining chafes, and he would rather be doing anything else. He is not a victim and
  // he is not a lesson. He is a teenager with a job he hates.
  {
    id: 'npc_thorn_ossa', name: 'Ossa Vurn', sex: 'male',
    home_zone: z(CX - 1, CY + 1), work_zone_id: z(1046, 968),
    // The shift he will not stop talking about, and the reason he is at the gate at all. An NPC
    // whose work zone differs from home MUST carry a schedule or CHECK_VENDOR_WORK reports offWork
    // forever and they never travel; content:lint refuses the row without one. Six hours, twice a
    // week, which is exactly what he tells you it is.
    vendor_schedule: { fri: [{ from: 12, to: 18 }], mon: [], sat: [], sun: [], thu: [], tue: [{ from: 12, to: 18 }], wed: [] },
    flags: { personality: 'labourer', clothing_layers: ['a coat two sizes too big, taken in at the shoulders', 'a bone mask pushed up onto the top of his head', 'boots that were somebody else\'s first'] },
    description: 'A lanky fifteen-year-old propped against the gate frame with a bone mask shoved up onto the top of his head like a pair of goggles, radiating the specific boredom of somebody four hours into a six-hour shift. He straightens up when he notices you, gets the mask most of the way down, thinks better of it, and leaves it there.',
    chitchat: [
      'Two hours. Two more hours.',
      'You are meant to be scared. Just so you know.',
      'It itches. Nobody tells you it itches.',
      'If you see Hale, I have been here the whole time.',
    ],
    dialogue_tree: {
      root: {
        first: 'He gets the mask halfway down, holds it there, and then gives up entirely and shoves it back onto his head. "Look, you have already seen my face, so." A shrug of magnificent adolescent fatalism. "Gate is open. Do not go in the beds. That is it, that is the whole speech."',
        text: 'The mask is on top of his head again. "Gate is open. Not the beds."',
        text_by_relation: {
          known: '"Oh, it is you." He does not even reach for the mask.',
          familiar: '"Tell me it is nearly the hour. Lie to me."',
          close: 'He brightens up considerably. "Right, good, talk to me, I am dying here."',
        },
        options: [
          opt('You are supposed to have that on.', 'mask'),
          opt('Whose idea was the road?', 'road'),
          opt('Vurn. I have heard that name.', 'vurn'),
          opt('Nothing.', 'bye'),
        ],
        actions: [],
      },
      mask: node('"It is padded. It is still hot." He pulls it off entirely and turns it over to show you, which somewhat undermines the point of it. The inside is quilted rag, stitched down flat at every edge in small even stitches. "My gran did the lining. She does everybody\'s. That seam there went last month and I got a lecture about it.\n\nSix hours, twice a week. And you have to do the walk, up and down, so they see you moving. That is the worst bit. Anyone can stand still."', [
        opt('Whose idea was the road?', 'road'),
        opt('Sounds rotten.', 'rotten'),
      ]),
      rotten: node('"It is rotten." He is delighted to have this conceded. "Thank you. Nobody says that. Everybody says it is four hours."\n\nHe puts the mask back on his head, wrong way round.\n\n"I want the tanks. Sill says not until I can do the numbers twice without checking, and I can do them once, so."', [opt('Right.', 'bye')]),
      // The one moment the fear is examined from the inside, by the only person young enough to
      // still find it strange. He does not resolve it. He is fifteen.
      road: node('"Before me." He says it the way you say a war. "Gran\'s, mostly, everyone says.\n\nI hate it. Not the shift, I mean the road. You have to walk down it to get out and it is horrible, and I know exactly who made every bit of it and it is still horrible in the dark."\n\nHe kicks the gate frame.\n\n"But my dad went over the wall at Coldwater and lives in a tenement now with two others and they are all right, and my gran says he only got the choice because nobody has ever come up that road with a rope. So."\n\nA shrug. He has plainly had this argument with himself many times and lost it every time.\n\n"So it is six hours. Twice a week."', [
        opt('Your dad?', 'vurn'),
        opt('Right.', 'bye'),
      ]),
      vurn: node('"Sledge. Sledge Vurn." He is unmistakably proud and trying not to be. "He is in the city. He sends things back sometimes, wire mostly, once a whole pump. Gran will not talk about it and Rindle will, so ask Rindle."', [opt('Right.', 'bye')]),
      bye: node('"Not the beds. Seriously, not the beds, I get it in the neck."'),
    },
  },
];

// ── Banter ───────────────────────────────────────────────────────────────────
// Threads, NOT flat strings: a flat string is silently dropped. Every one of these is domestic and
// none of them is about being a mutant, being feared, or the road. This is the sound of the flip.
const BANTER = [
  { id: 'bt_thorn_pump', lines: [
    '"It is your week on the pump."', '"It is not my week on the pump."',
    '"It is written down. In chalk. In your handwriting."', '"...it is my week on the pump."',
  ] },
  { id: 'bt_thorn_totem', lines: [
    '"Your totem has gone over again."', '"That is not my totem."',
    '"It is the one with the jaw wired wrong. It is yours."',
    'sighs, puts down the bucket, and goes to get the wire.',
  ] },
  { id: 'bt_thorn_birthday', lines: [
    '"She is nine on Thursday."', '"Nine. And what does nine want?"',
    '"A dog."', '"Nine is not having a dog. Hale would eat us."',
    '"Nine is getting a jar with a beetle in it and nine is going to love it."',
  ] },
  { id: 'bt_thorn_knife', lines: [
    '"Who has had the good knife."', '"Not me."',
    '"Somebody has had the good knife."', '"It will be Ossa. It is always Ossa."',
    '"It was not Ossa, Ossa has been on the gate since noon."', 'a long, guilty pause.',
  ] },
  { id: 'bt_thorn_stew', lines: [
    '"What is in it?"', '"Do not ask what is in it, ask if it is ready."',
    '"Is it ready?"', '"No."',
  ] },
  { id: 'bt_thorn_roof', lines: [
    '"Number four drum is overflowing again."',
    '"That is the channel, not the drum. The channel wants clearing above the elbow."',
    '"Then clear it above the elbow."', '"I am eating."', '"You are always eating."',
  ] },
];

function main() {
  for (const d of ['npcs', 'npc_banter_threads']) {
    const p = join(ROOT, 'content', d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
  for (const n of NPCS) write(join(ROOT, 'content', 'npcs', `${n.id}.json`), { ...base, ...n });
  BANTER.forEach((b, i) => write(join(ROOT, 'content', 'npc_banter_threads', `${b.id}.json`),
    { enabled: true, id: b.id, lines: b.lines, personality: null, sort_order: 100 + i }));
  console.log(`thornwarren: wrote ${NPCS.length} npcs, ${BANTER.length} banter threads`);
}

main();
