// One-shot seed for the shared NPC banter library (npc_banter_threads).
//
//   node server/models/temp/seed-banter.js          # seed only if empty
//   node server/models/temp/seed-banter.js --force   # wipe + reseed
//
// Deliberate, run-once. After this, the content lives in the DB and is edited via
// the dev panel (NPCs → 🗣 Banter Library). Requires `npm run db:schema` first so
// the npc_banter_threads table exists.

import 'dotenv/config';
import { query, getClient } from '../db.js';

// personality:null → generic (fits any pair). A slug limits a thread to that
// archetype's initiator. lines = ordered turns, spoken by alternating NPCs.
const GENERIC = [
  ['"You feel that? Pressure\'s dropping. Gonna rain acid again."', '"It always rains acid. That\'s just weather now."', '"Used to mean something, a storm. Now it\'s Tuesday."', 'shrugs and pulls their collar up.'],
  ['"Heard they found another body down by the transit line."', '"Ours or theirs?"', '"Does it matter anymore?"', '"...No. Suppose it doesn\'t."'],
  ['"Rent went up again. Same box, more credits."', '"Complain to who? The landlord\'s an algorithm."', '"Can\'t even argue with it. It just deducts."', 'laughs, but there\'s nothing behind it.'],
  ['"You remember real coffee? Before the substitute?"', '"I remember the smell. Can\'t remember the taste."', '"That\'s the worst part. The forgetting."', 'stares into the middle distance.'],
  ['"The machines were quiet last night. Too quiet."', '"Maybe they\'re done with us."', '"They\'re never done. They\'re just patient."', '"...Yeah. That\'s worse, isn\'t it."'],
  ['"Somebody\'s been through here. Look at the dust."', '"Everybody\'s been through here. It\'s a corridor."', '"No, recent. Boots, not drones."', 'glances toward the exit and lowers their voice.'],
  ['"I\'d kill for a working shower. Real water."', '"You\'d kill for less, these days."', '"Fair."', 'cracks a tired grin.'],
  ['"They say the upper levels still have power. Real light."', '"They say a lot of things about the upper levels."', '"You ever been?"', '"Nobody comes back to say."'],
  ['"Prices at the market are insane. A tin of protein for what?"', '"Supply and desperation. Classic combination."', '"One of these days I\'m just gonna stop eating."', '"Let me know how that works out."'],
  ['"Curfew drone came by twice already. Nervous night."', '"Something\'s got them spooked."', '"Something\'s always got them spooked. That\'s the job."', 'nods slowly, watching the ceiling.'],
];

const BY_PERSONALITY = {
  bartender: [
    ['"You want the usual, or are we pretending you have options?"', '"...The usual."', '"Thought so. Pay first."', 'wipes down the counter without looking up.'],
    ['"Third one tonight crying into their drink. Full moon or something."', '"There\'s no moon anymore. Just the haze."', '"Then it\'s just people. Even worse."'],
  ],
  thug: [
    ['"This block\'s ours. You standing in it means something."', '"I\'m just passing through."', '"Nobody just passes through. Remember the face."', 'cracks their knuckles, slow.'],
    ['"Nice gear. Real nice. Be a shame."', '"...Is that a threat?"', '"It\'s an observation. For now."'],
  ],
  guard: [
    ['"Move along. Nothing to see here."', '"I live here."', '"Then live somewhere I\'m not standing. Keep it moving."'],
    ['"Long shift. Two more like it before I sleep."', '"They working you to death?"', '"Death\'d be a day off. Eyes forward."'],
  ],
  preacher: [
    ['"The end was promised, friend. And the end delivered."', '"I\'m not interested."', '"Nobody is. That never stopped it coming."', 'raises a hand in something between blessing and warning.'],
    ['"Repent. It won\'t help, but the gesture matters."', '"Repent for what?"', '"You\'ll know. You always know."'],
  ],
  vagrant: [
    ['"You got a smoke? Just one, I\'m good for it."', '"You said that yesterday."', '"And I was good for it. Wasn\'t I still here?"', 'holds out a hopeful hand.'],
    ['"Don\'t sleep near the east wall. Trust me."', '"Why, what\'s at the east wall?"', '"...You don\'t wanna know. I know. That\'s enough for both of us."'],
  ],
  dealer: [
    ['"Pot\'s right. Cards are fair. Read your opponent, not your luck."', '"Easy for you to say. You deal them."', '"That\'s exactly why I say it."', 'squares the deck against the felt.'],
  ],
  doctor: [
    ['"You\'re favouring that leg. Old wound?"', '"It\'s nothing."', '"It\'s never nothing. Sign the waiver and I\'ll take a look."'],
  ],
  scientist: [
    ['"The readings from last night were... statistically unusual."', '"Unusual how?"', '"The kind of unusual I\'d rather not write down. Officially."', 'adjusts a cracked instrument and frowns.'],
  ],
  mercenary: [
    ['"You freelance, or you signed with somebody?"', '"I keep my options open."', '"Options close fast out here. Pick a paymaster before one picks you."'],
  ],
  cult_member: [
    ['"He is coming. He is always coming. Can you feel it?"', '"I feel a draft, mostly."', '"That is how it begins. The cold. The certainty."', 'smiles with unsettling patience.'],
  ],
  politician: [
    ['"We\'re making real progress. The data supports our approach."', '"The data says people are starving."', '"...We\'re exploring all options. Except, apparently, that one."'],
  ],
  unemployed: [
    ['"You hiring? No? Figured. Nobody is."', '"Times are hard for everyone."', '"Some of us are just more thorough about it."', 'kicks at a loose bit of rubble.'],
  ],
};

const force = process.argv.includes('--force');
const client = await getClient();
try {
  const { rows: existing } = await client.query('SELECT COUNT(*)::int AS n FROM npc_banter_threads');
  if (existing[0].n > 0 && !force) {
    console.log(`npc_banter_threads already has ${existing[0].n} row(s). Use --force to wipe and reseed.`);
    client.release();
    process.exit(0);
  }

  await client.query('BEGIN');
  if (force) await client.query('DELETE FROM npc_banter_threads');

  let i = 0;
  const insert = async (personality, lines) => {
    await client.query(
      'INSERT INTO npc_banter_threads (id,personality,lines,enabled,sort_order) VALUES ($1,$2,$3,TRUE,$4)',
      [`bt_seed_${i}`, personality, JSON.stringify(lines), i]
    );
    i++;
  };

  for (const lines of GENERIC) await insert(null, lines);
  for (const [slug, threads] of Object.entries(BY_PERSONALITY)) {
    for (const lines of threads) await insert(slug, lines);
  }

  await client.query('COMMIT');
  console.log(`Seeded ${i} banter thread(s) (${GENERIC.length} generic + ${i - GENERIC.length} personality).`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('ROLLED BACK:', e.message);
  client.release();
  process.exit(1);
}
client.release();
process.exit(0);
