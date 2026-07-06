// One-shot: give Brack the Fishmonger a real "how do you fish out here" dialogue
// branch (in-voice, teaches the loop without sounding like a tutorial), a
// once-gated free starter rod (the Watts kit pattern), and stock his slab with
// rods + bloodworm bait so replacements and bait are actually buyable.
//
//   node scripts/add-fishmonger-lesson.js
//   (then reload the world / restart so the NPC row reloads)
//
// Re-runnable: it overwrites Brack's dialogue_tree and vendor_inventory outright.
import { query } from '../server/models/db.js';

const NPC = 'npc_fishmonger';

// Brack sells his own gear now — rod (unique) + bloodworm bait — alongside food.
const VENDOR_INVENTORY = [
  { price: 45, item_id: 'item_fishing_rod' },
  { price: 6, item_id: 'item_bloodworm_bait' },
  { price: 7, item_id: 'item_fresh_catch' },
  { price: 10, item_id: 'item_ration' },
  { price: 5, item_id: 'item_water_bottle' },
];

const DIALOGUE = {
  root: {
    text: 'Brack slaps a pale fillet onto the slab. "Fresh off the bay, mostly fish! Buyin\' your catch too, if it\'s got fewer than three eyes."',
    options: [
      { next: '__shop__', label: 'Show me the catch.' },
      { next: 'how', label: "How's a man pull his own dinner out of that water?" },
      { next: 'bye', label: 'Not hungry.' },
    ],
  },

  how: {
    text: 'He barks a laugh like a dropped crate. "You? Fish? Ha!" He wipes the cleaver on his apron and looks you over, softening. "Ah, everyone starts somewhere. It\'s no great secret. You plant your boots on my boards, you wet a line, and you FISH. That\'s the whole word for it — you just *fish*, and you wait, and the bay decides if it likes you." He nods at the black water slopping against the pilings. "Thing takes your line, you\'ll feel the whole dock lean. That\'s you and it, arm-wrestlin\' through the murk."',
    options: [
      { next: 'reel', label: 'And then what — I just haul it up?' },
      { next: 'rod', label: "I don't even have a rod.", conditions: { op: 'unset', flag: 'got_first_rod' } },
      { next: 'rodmore', label: 'Where do I get a decent rod?', conditions: { op: 'set', flag: 'got_first_rod' } },
      { next: 'bait', label: "What's worth catching out there?" },
      { next: 'root', label: 'Back.' },
    ],
  },

  reel: {
    text: '"Haul it up." He snorts. "Sure. You *keep the pressure on it*, is what you do. Too slack and it laughs at you and swims off with your hook. Too hard and my rod\'s in two pieces and you\'re buyin\' me a new one." He mimes a straining reel, thick forearms flexing. "Land it or lose it — that\'s the bay. You\'ll get the feel in your hands before your head catches up." His grin drops a notch. "And now and then somethin\' pulls back that had no business fittin\' on a hook. You\'ll know. Everybody within a mile\'ll know. Brace up or cut it loose — just don\'t bleed on my dock."',
    options: [
      { next: 'rod', label: 'Set me up, then.', conditions: { op: 'unset', flag: 'got_first_rod' } },
      { next: 'bait', label: 'What about bait?' },
      { next: 'root', label: 'Back.' },
    ],
  },

  bait: {
    text: '"Bay\'ll hand you a waterlogged boot or some dead man\'s fingers for free, all day long." He shrugs, unbothered. "But the stuff with real credits in it — glass eels, the delicate glowin\' things — those you gotta feed first. Bloodworms." He taps a twist of waxed paper on the slab. "Disgustin\' little things. The eels go stupid for \'em. I sell \'em, \'course I do."',
    options: [
      { next: '__shop__', label: 'Sold. Show me.' },
      { next: 'how', label: 'Back.' },
    ],
  },

  rod: {
    text: '"No rod." He shakes his head, already reaching under the slab. "Can\'t fish the bay with your good looks, can you." He drags out a battered telescopic rod, guides furred with old salt, and presses it into your hands. "This one\'s a loaner that ain\'t comin\' back — first one\'s on me, \'cause a man who never wet a line is a sad thing to look at. Now get out on my boards and *fish*. Line snaps, worms run dry, you come back and see me — I\'ll take your credits like an honest man."',
    actions: [
      { action: 'GRANT_ITEM', item_id: 'item_fishing_rod', quantity: 1 },
      { action: 'SET_FLAG', flag: 'got_first_rod', value: 'true' },
    ],
    options: [
      { next: 'bait', label: "What'll I catch?" },
      { next: 'bye', label: "Boots on the boards it is." },
    ],
  },

  rodmore: {
    text: '"Snapped it already?" The laugh again. "Or lost it down a gullet, more like." He thumbs at the slab. "I keep spares. Not free this time — I\'m a fishmonger, not your mother. Buy one off me and mind the line better."',
    options: [
      { next: '__shop__', label: 'Fine. Show me.' },
      { next: 'how', label: 'Back.' },
    ],
  },

  bye: {
    text: '"Suit yourself. Cats aren\'t fussy."',
    options: [],
  },
};

const { rowCount } = await query(
  'UPDATE npcs SET dialogue_tree=$1, vendor_inventory=$2 WHERE id=$3',
  [JSON.stringify(DIALOGUE), JSON.stringify(VENDOR_INVENTORY), NPC]
);

if (!rowCount) { console.error(`NPC ${NPC} not found.`); process.exit(1); }
console.log(`Updated ${NPC}: new fishing-lesson dialogue + rod/bait in vendor inventory.`);
process.exit(0);
