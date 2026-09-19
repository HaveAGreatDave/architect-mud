/**
 * Halcyon Fields, batch 1 — the money half.
 *
 * Buildings on the north kerb of Halcyon Boulevard and along Kettle Lane's west side,
 * under the Spire. Run after batch0, which lays the streets these front onto.
 *
 *   node scripts/content/halcyon/batch1.mjs [--dry-run]
 *
 * Idempotent: every id derives from the placement, so a re-run is an upsert.
 */
import { authorBuilding, loadContentStore } from './lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

const SPECS = [];

// ── Sound Investment ─────────────────────────────────────────────────────────
// A recital hall endowed by Halcyon Assurance. The endowment requires a season of
// forty concerts a year. It does not require an audience. Forty concerts happen.
SPECS.push({
  slug: 'sound', name: 'Sound Investment', type: 'concert_hall',
  x: 893, y: 911, entrance: 'north', floors: 5, marker: 'SD', district: 'halcyon_fields',

  facade: {
    bgColor: '#1d1c24', color: '#d8d2bc',
    description: 'A stone front of five tall bays with no shopfront in it at all, set back behind a strip of gravel that was drawn on a plan as a forecourt. Cut into the lintel in letters a foot high: SOUND INVESTMENT. Underneath, smaller and in a different hand, ENDOWED IN PERPETUITY. The fly tower behind it goes up another two storeys, blank and windowless, and the whole building turns its shoulder to the Spire rather than facing it. A glass case by the doors holds the season: forty dates, typed, four of them crossed out and typed again.',
  },

  rooms: [
    { key: 'foyer', name: 'The Foyer', floor: 'stone',
      description: 'Terrazzo underfoot and a ceiling higher than the room is wide, which is how you can tell the money was there at the beginning. The box-office window is brass and glass with a brass dish under it worn bright in one spot. Along the left wall the donors are cut into stone in three columns, and the last name in the third column went up a long time ago. A bell on a bracket by the auditorium doors gets rung by hand at five minutes, and again at one.',
      window: {
        name: 'the entrance bays',
        description: 'Five tall lights onto Halcyon Boulevard, and through them a road of packed gravel with a storm drain choked with silt. The glass is very clean.',
        light: 0.55, visibility: 0.7,
      } },
    { key: 'house', name: 'The Auditorium', floor: 'carpet', from: 'foyer', dir: 'south',
      description: 'Four hundred seats in dark red, raked, with a brass number screwed to every arm. Twelve of them are worn through to the backing. The rest are as they came, and have been as they came for years. The ceiling is a shallow dome ringed with dead bulbs and a smaller ring inside it that still works. It is warmer in here than in the foyer, because heating an empty hall costs less than explaining why you stopped.' },
    { key: 'platform', name: 'The Platform', floor: 'boards', from: 'house', dir: 'south',
      description: 'A shallow stage of pale boards with a grand piano at the centre of it under a dust sheet that comes off forty times a year. Overhead the fly tower climbs into the dark on a grid of bars, nearly all of them empty, one of them carrying a cloth nobody has lowered in living memory. The acoustic is extraordinary. Standing here you can hear yourself swallow.' },
  ],

  utility: {
    name: 'The Plant Room', floor: 'stone',
    description: 'Under the foyer: the blowers that keep an empty hall at nineteen degrees, and the cabinet that feeds them. A chart recorder on the wall has been drawing the same flat line onto a roll of paper since before anybody here started, and somebody still changes the roll.',
  },

  lights: {
    house: { name: 'the dome ring', description: 'A ring of bulbs inside a larger ring of dead ones, throwing a soft even light down onto four hundred empty seats.', lumens: 1800 },
    platform: { name: 'the stage bar', description: 'One bar of lamps left rigged over the platform, gelled a warm straw colour that flatters nobody and nothing, and was chosen for that.', lumens: 2200, type: 'overhead' },
  },

  props: [
    { key: 'window', room: 'foyer', name: 'the box-office window', objectType: 'fixture',
      description: 'Brass and glass, with a half-moon cut in it to speak through and a dish underneath worn bright in the one spot where hands land.',
      flags: { aliases: ['box office', 'window', 'booth'], interactions: { examine: 'The card taped inside the glass reads ONE PRICE, ALL SEATS, and the price has been amended twice in biro.' } } },
    { key: 'drawer', room: 'foyer', name: 'the cash drawer', objectType: 'fixture', lightType: 'lamp',
      description: 'A shallow wooden drawer under the box-office shelf with a brass lock and a sprung tray inside. The lock is original and is not a serious lock.',
      flags: { aliases: ['drawer', 'till', 'cash'], vendor_safe: true, vendor_npc_id: 'npc_sound_sedge', hack_difficulty: 3 } },
    { key: 'donors', room: 'foyer', name: 'the donor wall', objectType: 'decoration',
      description: 'Three columns of names cut into the stone and filled with gilt, most of it still there. The list stops partway down the third column and the stone below it was never cut.',
      flags: { aliases: ['wall', 'donors', 'names'], interactions: { examine: 'Halcyon Assurance heads the first column. The rest are individuals, and every one of them is listed with the year they gave and no year after it.' } } },
    { key: 'bell', room: 'foyer', name: 'the call bell', objectType: 'fixture',
      description: 'A brass handbell on a bracket beside the auditorium doors, kept polished, with a strip of felt glued inside the rim to take the edge off it.',
      flags: { aliases: ['bell', 'handbell'], interactions: { examine: 'Rung at five minutes and again at one. The felt was added by somebody who had to stand next to it.' } } },
    { key: 'case', room: 'foyer', name: 'the season case', objectType: 'decoration',
      description: 'A glazed case on a stand holding the season on a single typed sheet. Forty dates. Four have been crossed through and typed again underneath.',
      flags: { aliases: ['case', 'season', 'board'], interactions: { examine: 'The crossings-out are all the same performer, moved and moved and moved again, and then finally listed with a different name beside the date.' } } },
    { key: 'seats', room: 'house', name: 'the seats', objectType: 'furniture',
      description: 'Four hundred of them in dark red, raked, each with a brass number on the arm. Rows are lettered from the front. Twelve seats are worn and they are not together.',
      flags: { aliases: ['seat', 'seats', 'chairs', 'row'], interactions: { sit: 'You pick a seat. The hinge is stiff and takes a push, then settles you lower than you expected.' } } },
    { key: 'piano', room: 'platform', name: 'the house piano', objectType: 'furniture',
      description: 'A full-length grand in black, under a fitted dust sheet with the corners tied. The lid prop is kept in a clip inside the case rather than left standing, which is what somebody does when they intend to still be doing this next year.',
      flags: { aliases: ['piano', 'grand'], instrument: { kind: 'piano' }, interactions: { examine: 'The dust sheet comes off forty times a year, and the tuner comes the morning of each one.' } } },
  ],

  items: [
    { id: 'item_sound_ticket', name: 'a recital ticket', type: 'misc', value: 14, weight: 2, description: null, flags: {},
      tags: { stackable: true, description: 'Card, cream, printed rather than torn off a roll, with the date and the seat written on in ink by hand. There is a line for the performer and on this one it has been left blank, which happens more often than the season case admits.' } },
    { id: 'item_sound_programme', name: 'a season programme', type: 'media', value: 6, weight: 14, description: null, flags: {},
      tags: { stackable: true, description: 'A stapled booklet for the whole season rather than the night, so most of it is about concerts that have already happened. The notes are unsigned, closely argued, and plainly written by somebody who has read more about this than anyone who will read them.' } },
    { id: 'item_sound_gin', name: 'an interval gin', type: 'drink', value: 22, weight: 90, description: null, flags: {},
      tags: { stackable: false, description: 'Gin and something in a heavy plastic cup, poured at the interval from a table in the foyer and left on the shelf outside the doors when the bell goes. It is a large measure. Nobody is watching the bottle.' } },
  ],

  npc: {
    id: 'npc_sound_sedge', name: 'Perpetua Sedge', sex: 'female', hp: 34,
    homeRoom: 'platform', workRoom: 'foyer', shopName: 'Sound Investment',
    description: 'A tall, upright woman past fifty in a black dress with a house badge pinned at the shoulder, standing at the box-office window rather than sitting behind it. She has the bearing of somebody managing a full house and there are eleven people in the building. Her reading glasses hang on a cord and she does not use them for faces.',
    clothing: [
      'a plain black house dress, pressed, with a brass house badge at the shoulder',
      'flat black shoes kept for indoors and changed at the door',
      'a cardigan carried over one arm for the auditorium, which is warm, and the foyer, which is not',
      'a slip and plain underthings',
    ],
    inventory: [
      { item_id: 'item_sound_ticket', price: 14 },
      { item_id: 'item_sound_programme', price: 6 },
      { item_id: 'item_sound_gin', price: 22 },
    ],
    chitchat: [
      'Sedge squares the ticket cards against the shelf until the edges line up, then squares them again.',
      'She glances at the clock over the doors, and then at the bell, and then back at the clock.',
      'She writes the night\'s number in a ruled book. It is a small number. She writes it the same size as any other.',
      'Somewhere behind the auditorium doors a piano runs a figure, stops, and runs it again slower.',
      'She straightens the season case on its stand by about a degree.',
    ],
    dialogue: {
      root: {
        text: '"Good evening." She turns from the window to face you squarely, which almost nobody does. "Doors at half past, bell at five minutes and again at one. One price, all seats, and you may sit wherever you like."',
        text_by_relation: {
          first: 'The woman at the box office finishes squaring a stack of cards, sets them down, and gives you her whole attention at once.\n\n"Good evening. Perpetua Sedge, house manager." A short nod, as though the name settles something. "You will want to know what it is. It is a recital, it is an hour and ten with no interval tonight, and it is very good."\n\nShe says the last part without any salesmanship at all, as a fact she expects to be checked.\n\n"One price, all seats. Sit near the front. It was built for the front."',
          known: '"You came back." She does not make anything of it, but the ticket card is already out of the stack. "Same arrangement. Sit where you like."',
          familiar: 'She has the card written before you reach the window, and turns it round on the shelf with two fingers so it faces you.\n\n"Row C," she says. "The piano is being difficult in the bass and C is where you will not notice." A pause. "Or will enjoy noticing. I have never worked out which you are."',
        },
        options: [
          { label: 'What\'s the season?', next: 'season' },
          { label: 'Tickets, please.', next: '__shop__' },
          { label: 'Who pays for all this?', next: 'endow' },
          { label: 'Where is everybody?', next: 'house' },
          { label: 'Heard anything worth hearing?', next: 'gossip' },
          { label: 'Nothing for now.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      season: {
        text: '"Forty dates a year." She indicates the case without looking at it. "That is not a programme I built, it is a number I was given, and I have come round to it. Forty is enough that nobody can call it a gesture and few enough that I can get every one of them right."\n\n"We have had the same four players for a while now. They are better than they were. That is the part nobody comes to see."',
        options: [
          { label: 'The same four?', next: 'players' },
          { label: 'Back.', next: 'root' },
        ],
      },
      players: {
        text: '"They have other work. Everybody has other work." She says it flatly, without complaint. "One of them fixes looms in the Filaments and has the hands for it, which you would think would ruin her and has not."\n\n"They are paid, before you ask. Properly, and first, and out of the same money that heats the room. I made that argument once and won it, and I have never had to make it twice."',
        options: [{ label: 'Back.', next: 'season' }],
      },
      endow: {
        text: '"An endowment." She lets that sit for a second to see whether it is going to be enough, and it is not. "Halcyon Assurance. A long time ago somebody there put a sum aside and wrote terms on it, and the terms say a season of forty."\n\n"They do not say an audience. I have read them. I read them properly, once, the first year, in case there was a clause that would let somebody shut it."',
        options: [
          { label: 'Was there?', next: 'endow_clause' },
          { label: 'Back.', next: 'root' },
        ],
      },
      endow_clause: {
        text: '"No." A very small satisfaction gets into her voice and is put away again. "Whoever drew it up was careful. They tied it to the performance and not to the return, which is not how that firm writes anything now, so I think it was a person rather than a committee."\n\n"So it runs. It will run after me. That is the whole of what an endowment is for, and it is the only thing in this quarter I would call sensible."',
        options: [{ label: 'Back.', next: 'endow' }],
      },
      house: {
        text: '"Eleven tonight, with you." No edge on it at all. "It has been eleven or near it for years. I stopped finding that remarkable some time ago and I would rather you did too."\n\n"It is not a failure. A failure would be forty nights that did not happen. These happen."',
        options: [
          { label: 'Doesn\'t that get to you?', next: 'house_why' },
          { label: 'Back.', next: 'root' },
        ],
      },
      house_why: {
        text: 'She thinks about it, which is not the same as hesitating.\n\n"The bell still goes at five minutes," she says. "Latecomers still wait at the doors until the movement ends, and they mind, and they are right to mind. The lights still come down at the same rate. If I let any of that slip because there were eleven of you, then in a year there would be four of you, and the reason would be me."\n\n"So no. It does not get to me. It is the job."',
        options: [{ label: 'Back.', next: 'house' }],
      },
      gossip: {
        text: '"I hear the building more than the street." She tips her head toward the boulevard. "They are putting a road through the meadow. You can feel the plant at night through the floor, which the piano does not care for."\n\n"And somebody from the land office came in to measure the forecourt. Not to buy it. To measure it. I gave him a programme and he took it, which I thought was decent of him."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: {
        text: '"Enjoy it." She turns back to the window and squares the cards.',
        options: [],
      },
    },
  },
});

// ── run ──────────────────────────────────────────────────────────────────────
for (const spec of SPECS) {
  const r = await authorBuilding(store, spec);
  console.log(`  ${spec.name.padEnd(22)} ${spec.x},${spec.y}  ent=${spec.entrance}  ${r.facadeId}`);
}
const written = store.flush({ dryRun: DRY });
console.log(`\n${DRY ? 'DRY RUN — ' : ''}${written.length} file(s) ${DRY ? 'would change' : 'written'}`);
if (store.droppedRuntime.length) console.log(`  (dropped ${store.droppedRuntime.length} runtime write(s))`);
