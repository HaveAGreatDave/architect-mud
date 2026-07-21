// scripts/reach-regular-npc.mjs — one-shot content authoring.
//
// Adds the Coyote's Rest its missing piece: a regular. Marla works the bar, Doc
// deals, Del plays — all of them are STAFF, and a haven with nothing but staff
// reads as a shop. Windy is the man who is simply always there.
//
// He's also the room's rumour mouth: his dialogue wires GOSSIP_TELL, which is
// where the Reach grapevine seeded in plugins/gossip surfaces (see the
// `reach_wire` template). And because he has no work_zone_id and no schedule he
// is never "on shift", so unlike the staff he IS eligible for the shared
// npc-banter tick — he's the one who talks when the bar is otherwise quiet.
//
// Idempotent (upsert). Writes the DB and the content file.
//
//   node scripts/reach-regular-npc.mjs                     # local dev DB
//   node --env-file=.env.prod scripts/reach-regular-npc.mjs # prod

import { writeFileSync } from 'node:fs';
import { query } from '../server/models/db.js';
import { contentEntries } from '../server/models/content-registry.js';
import { CONTENT_DIR, canonicalJson, fileNameForRow, rowToFileObject } from './content/lib.mjs';

const ID     = 'npc_reach_regular';
const SALOON = 'zone_bld_899_1171_lobby';

// The joke is that all three tales are the same story with the details moved
// around, and he tells them with total conviction. Nobody in the Reach has ever
// corrected him, because correcting him would mean admitting they'd listened.
const DIALOGUE = {
  root: {
    _vine: { x: 60, y: 200 },
    text: [
      'Windy focuses on you with some effort, and a great deal of goodwill. "Now then. Now then. You\'re new."',
      'He turns on his stool, slowly, like a gun turret. "Sit. Sit down. You\'ve got the look of someone who\'d appreciate a bit of history."',
      '"There he is." He says this to you, though you have never met. "Get a chair. I was just about to tell it."',
    ],
    options: [
      { label: 'How\'d you end up out here?', next: 'tale_1' },
      { label: 'That scar — where\'d you get it?', next: 'tale_2' },
      { label: 'What\'s the worst run you ever flew?', next: 'tale_3' },
      { label: 'Heard anything worth hearing?', next: 'word' },
      { label: 'Maybe later.', next: null },
    ],
  },
  tale_1: {
    _vine: { x: 460, y: 60 },
    text: '"Flew a load out of the Redline with three drums of something the buyer wouldn\'t name and half a wing. '
      + 'Storm took me sideways over the flats — I put her down on her belly a mile short of this very strip and walked in "'
      + '<span class="text-dim">— he holds up a finger —</span>" barefoot. Boots burned off. Marla poured me one before I\'d said a word. '
      + 'Never left. Never saw a reason to."',
    options: [
      { label: 'Barefoot?', next: 'tale_press' },
      { label: 'Tell me another.', next: 'root' },
      { label: 'Right. Well.', next: null },
    ],
  },
  tale_2: {
    _vine: { x: 460, y: 260 },
    text: '"This?" He tips his chin up so you get the full benefit. "Customs man at a policed field, and he had a hook. '
      + 'Three drums in the hold and he\'s going through my manifest like it\'s scripture. So I put her nose up off the numbers '
      + 'with him still holding the door." <span class="text-dim">He drinks.</span> "Cost me a strip of throat and the door. '
      + 'Landed here on fumes and no boots. Never left."',
    options: [
      { label: 'Wasn\'t it a storm last time?', next: 'tale_press' },
      { label: 'Tell me another.', next: 'root' },
      { label: 'Right. Well.', next: null },
    ],
  },
  tale_3: {
    _vine: { x: 460, y: 460 },
    text: '"Worst run." He says it like you\'ve asked him to pick a favourite child. "Three drums, a buyer who wouldn\'t give a name, '
      + 'and eleven hundred miles of nothing with the gauge sat on the peg the whole way. I came over that ridge out there "'
      + '<span class="text-dim">— he gestures at a wall —</span>" on vapour and prayer, and the strip came up out of the dust like a hand. '
      + 'Set her down. Walked in. No boots on me at all." He nods, satisfied. "Never left."',
    options: [
      { label: 'It\'s always three drums, isn\'t it.', next: 'tale_press' },
      { label: 'Tell me another.', next: 'root' },
      { label: 'Right. Well.', next: null },
    ],
  },
  tale_press: {
    _vine: { x: 880, y: 260 },
    text: 'Windy looks at you with enormous, unhurried patience, the way you\'d look at a child who has just discovered that the sea is wet. '
      + '"Son," he says, "out here a story doesn\'t have to be true. It has to be worth the second telling." '
      + '<span class="text-dim">He turns back to the bar, entirely at peace.</span>',
    options: [
      { label: 'Fair enough.', next: 'root' },
      { label: 'Leave him to it.', next: null },
    ],
  },
  word: {
    _vine: { x: 880, y: 480 },
    actions: [{ action: 'GOSSIP_TELL' }],
    text: 'He leans in with the terrible conspiratorial precision of the very drunk.',
    options: [
      { label: 'Huh.', next: 'root' },
      { label: 'That\'s enough for one night.', next: null },
    ],
  },
};

// One-turn threads — the shape npc-banter actually reads (a thread is a list of
// turns). He's off-shift by construction, so these are the lines the bar fills
// its silences with.
const BANTER = [
  ['Windy raises his glass to nobody in particular and drinks to it anyway.'],
  ['"Three drums," Windy says, to the room. Nobody asks. He seems content.'],
  ['Windy starts a sentence, loses it somewhere around the third word, and lets it go.'],
  ['"Anybody hear an engine just then?" Windy asks. Nobody did.'],
  ['Windy studies the bottom of his glass with the concentration of a man reading a map.'],
  ['"I could still fly," Windy announces. "I choose not to." He settles back, vindicated.'],
  ['Windy tips his stool back against the bar, closes his eyes, and does not fall.'],
  [
    '"You want to hear how I got out here?"',
    '"No."',
    '"Right you are. Right you are."',
  ],
];

const NPC = {
  id: ID,
  name: 'Wendell "Windy" Marsh',
  description: 'A weathered man welded to the third stool from the end, where the bar has worn pale in the shape '
    + 'of his forearms. Broken veins map his cheeks; a white seam of old scar runs up under his jaw and disappears '
    + 'into his beard. His hands are a pilot\'s hands — thick, scarred, still steady — and they never quite stop '
    + 'moving, walking through a checklist for an aircraft that is not there. He is delighted to see you. He is '
    + 'delighted to see everybody.',
  zone_id: SALOON,
  home_zone: SALOON,       // he doesn't commute. He doesn't go anywhere.
  work_zone_id: null,      // never "on shift" → eligible for the shared banter tick
  faction: null,
  npc_type: 'npc',
  sex: 'male',
  hp: 20,
  hp_max: 20,
  dialogue_tree: DIALOGUE,
  banter: BANTER,
  chitchat: [],
  behaviour_graph: {},     // ensureBehaviourGraph fills the default at boot
  vendor_inventory: [],
  vendor_schedule: {},
  vendor_shop_name: null,
  vendor_stock_size: 10,
  vendor_restock_rate: 1,
  home_activities: [],
  studio_zone_id: null,
  wanders: 0,
  wander_zones: [],
  flags: {
    personality: 'vagrant',
    haunt_zone: SALOON,    // pins him to the stool if the default graph gets ideas
    clothing_layers: [
      'a flight jacket so old the patches have gone to shadow and thread',
      'a shirt that was white about four years ago',
      'canvas trousers, a belt on its last hole, and long johns',
    ],
  },
};

const J = (v) => JSON.stringify(v);

async function main() {
  const { rows: zone } = await query('SELECT id FROM zones WHERE id = $1', [SALOON]);
  if (!zone.length) throw new Error(`saloon zone ${SALOON} not found`);

  await query(
    `INSERT INTO npcs (id, name, description, zone_id, home_zone, work_zone_id, faction, npc_type, sex,
                       hp, hp_max, dialogue_tree, banter, chitchat, behaviour_graph, vendor_inventory,
                       vendor_schedule, vendor_shop_name, vendor_stock_size, vendor_restock_rate,
                       home_activities, studio_zone_id, wanders, wander_zones, flags)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, description = EXCLUDED.description, zone_id = EXCLUDED.zone_id,
       home_zone = EXCLUDED.home_zone, work_zone_id = EXCLUDED.work_zone_id, npc_type = EXCLUDED.npc_type,
       sex = EXCLUDED.sex, dialogue_tree = EXCLUDED.dialogue_tree, banter = EXCLUDED.banter,
       flags = EXCLUDED.flags, wanders = EXCLUDED.wanders`,
    [NPC.id, NPC.name, NPC.description, NPC.zone_id, NPC.home_zone, NPC.work_zone_id, NPC.faction,
     NPC.npc_type, NPC.sex, NPC.hp, NPC.hp_max, J(NPC.dialogue_tree), J(NPC.banter), J(NPC.chitchat),
     J(NPC.behaviour_graph), J(NPC.vendor_inventory), J(NPC.vendor_schedule), NPC.vendor_shop_name,
     NPC.vendor_stock_size, NPC.vendor_restock_rate, J(NPC.home_activities), NPC.studio_zone_id,
     NPC.wanders, J(NPC.wander_zones), J(NPC.flags)]);

  const entry = contentEntries().find(e => e.table === 'npcs');
  const { rows } = await query('SELECT * FROM npcs WHERE id = $1', [ID]);
  writeFileSync(`${CONTENT_DIR}/npcs/${fileNameForRow(entry, rows[0])}`,
    canonicalJson(rowToFileObject(entry, rows[0])), 'utf8');

  console.log(`✓ ${NPC.name} is on the third stool from the end.`);
  console.log(`  ${Object.keys(DIALOGUE).length} dialogue nodes, ${BANTER.length} banter threads.`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
