// scripts/reach-alive.mjs — one-shot content authoring for the Reach.
//
// The Reach had four themed buildings and six NPCs but read as a diorama: one
// scrubland ambient pool covering all 400 tiles, silent interiors, and per-NPC
// banter stored in a shape the engine drops on the floor. This fills in the
// lived-in texture:
//
//   1. Ambient pools split by what the ground actually IS — made ground (the
//      strip and the street) sounds like a town, the apron sounds like an
//      airfield, and every interior gets its own. The 372 scrub tiles keep the
//      existing scrubland pool.
//   2. A second intro_lore beat on the main street, so arrival lands twice:
//      once when you land, once when you walk into town.
//   3. The banter FORMAT FIX. server/engine/npc-banter.js:160 keeps only entries
//      that are arrays (`banter.filter(t => Array.isArray(t) && t.length)`) —
//      a thread is a list of turns. All six Reach NPCs stored flat strings, so
//      every one of those lines was dead content. They're rewrapped as threads
//      here, plus real two-handers for the residents who share the motel at night.
//
// Writes the DB *and* the matching content/*.json files, because content:import
// is additive and can't rewrite an existing row. Idempotent — safe to re-run.
//
//   node scripts/reach-alive.mjs                     # local dev DB
//   node --env-file=.env.prod scripts/reach-alive.mjs # prod

import { writeFileSync } from 'node:fs';
import { query } from '../server/models/db.js';
import { contentEntries } from '../server/models/content-registry.js';
import { CONTENT_DIR, canonicalJson, fileNameForRow, rowToFileObject } from './content/lib.mjs';

// ── Ambient pools ─────────────────────────────────────────────────────────────
// Zone ambient_events is a flat array of strings, tried before the themed global
// pool (server/engine/world.js:1118) and rolled ~40% per zone per 45s tick. No
// conditions are available on these — anything time-of-day gated would have to be
// an ambient_routines row instead.

// Made ground: the dirt street and the strip approach. This is the town — you can
// hear people living here, which is the whole difference from the scrub.
const TOWN = [
  'Somewhere behind a wall, two voices are having the same argument they had last night.',
  'A screen door bangs. Nobody comes out.',
  'The dirt holds every footprint that\'s crossed it today. There are not many.',
  'A generator note wavers, catches, and settles back into its drone.',
  'Somebody\'s radio is playing the same three songs the Coyote\'s Rest plays. There is only the one tape out here.',
  'Grit drifts across the road in long slow ribbons, filling in yesterday\'s ruts.',
  'A dog you never see barks twice, somewhere past the last building, and thinks better of it.',
  'The heat comes up off the road in a sheet. Nothing moves in it.',
  'An engine drones somewhere overhead. Every face in the street tilts up, watches, and goes back to what it was doing.',
  'Someone has scratched a tally into a doorframe. Forty-odd marks. No indication of what they count.',
  'Bootprints, tyre-ruts, and a long smooth drag where something heavy got hauled toward the field.',
  'Washing hangs dead-still on a line, bleached to no colour at all.',
  'The light goes long and copper and every building in the Reach throws a shadow twice its height.',
];

// The apron at Buzzard Field — the only door in or out. It sounds like work.
const FIELD = [
  'The windsock hangs dead. It has hung dead for days.',
  'Tie-down chains tick against the hardpan in a wind that can\'t decide.',
  'Somebody has chalked a tail number onto the apron, then crossed it out.',
  'The smell of avgas rolls off the bowser, thick enough to taste.',
  'A loose sheet of hangar cladding lifts, bangs, and settles.',
  'Fuel stains map the apron in overlapping rings, oldest to newest.',
  'The burned-out hulk at the edge of the strip ticks as the day\'s heat leaves it.',
  'A buzzard drops onto the hangar roof, folds up, and settles in to wait.',
  'Out past the threshold the strip runs off into scrub and just... stops.',
  'Somewhere in the hangar a radio hisses, catches half a word, and loses it again.',
];

const SALOON = [
  'The speaker in the corner coughs, loses the song, and finds it again a bar later.',
  'Someone at the back booth laughs too loud, then remembers where they are.',
  'The boards creak as the building lets go of the day\'s heat.',
  'A moth batters itself against the lamp over the bar, patient and stupid.',
  'Glasses knock. Nobody toasts anything.',
  'The door goes. Everybody clocks it without looking up.',
  'A chair scrapes back. Whoever it was decides to stay after all.',
  'Somebody counts a fold of cash under the table, lips moving.',
  'The lamp over the poker table swings a little, though nothing has touched it.',
  'Dust comes off the ceiling when the wind gets under the roof.',
];

const STASH = [
  'Something in one of the crates shifts, settles, and is quiet.',
  'Cold comes off the stone down here in a way it never does upstairs.',
  'A keg sweats. Beside it, a crate with no markings at all sweats too.',
  'The floorboards overhead take somebody\'s weight, cross the room, and go still.',
  'Gun-oil, yeast, and underneath both of them something you can\'t place.',
  'Chalk marks on the crate ends — tallies, initials, one that\'s been scrubbed at.',
];

const MOTEL = [
  'The desk fan turns a slow quarter-circle and gives up.',
  'A key hangs on the board for a cabin nobody has claimed in a long time.',
  'The register lies open. Most of the names in it are obviously not names.',
  'Somebody moves in one of the cabins, and the whole building hears about it.',
  'A moth ticks against the office window, on the outside, wanting in.',
];

const WALK = [
  'A cabin light goes on behind a curtain, then off again.',
  'The walkway boards give under you, one soft note each.',
  'Somebody\'s left boots outside their door, turned neatly toward the wall.',
  'The VACANCY sign buzzes. The C in it has been dead for years.',
  'Wind runs the length of the walkway, turns the corner, and is gone.',
];

const DYNAMO = [
  'The genset changes pitch, hunts for a moment, and settles.',
  'A gauge needle drifts up, hangs, and falls back. Nobody has looked at it in years.',
  'Something arcs behind a panel — a hard blue snap and the smell of hot metal.',
  'The floor hums through your boots at a frequency you feel in your teeth.',
  'Cable runs vanish into the wall in a bundle thick as a man\'s arm, taped and re-taped.',
  'The whole shack shudders once, like a cough, and carries on.',
];

// ── The main street lore beat ─────────────────────────────────────────────────
// Buzzard Field's hangar bay already carries the arrival block ("you come in by
// air or you don't come in"). This is the second half: what the town is once
// you're standing in it. Fires once, stamped on departure (plugins/lore).
const STREET_LORE =
  'So this is it — one dirt street, four buildings that matter, and a horizon with '
  + 'nothing on it in any direction. Everyone here flew in. Every one of them had a '
  + 'reason not to stay wherever they came from, and nobody has ever been rude enough '
  + 'to ask what it was. That is the arrangement, and it is the only law the Reach '
  + 'keeps: the Reach does not care what you did. It cares whether you can be trusted '
  + 'not to bring it back with you.';

const STREET_ZONE = 'zone_the_reach_872_1955';   // the crossroads, saloon on one side

// ── Banter threads ────────────────────────────────────────────────────────────
// A thread is a list of TURNS, spoken alternately by the (up to two) NPCs the
// scene picked — so a one-turn thread is a solo line, and a multi-turn thread has
// to read naturally in either mouth after the first. Note npc-banter excludes
// on-shift NPCs, so these fire in the evenings at the motel and on the walk home,
// not behind the bar (that's the bartender plugin's coworker scenes).
const SOLO = (lines) => lines.map(l => [l]);

// Two-handers written to work between any pair of Reach residents off-shift.
const RESIDENT_THREADS = [
  [
    '"Anything come in today?"',
    '"Nothing came in today."',
    '"Right."',
  ],
  [
    '"You ever count how many of us there actually are out here?"',
    '"I did once. I didn\'t like the number, so I stopped."',
  ],
  [
    'squints west, where the light is going. "Storm in that."',
    '"There\'s storm in everything out here. Doesn\'t mean it\'s coming."',
    '"Doesn\'t mean it isn\'t."',
  ],
  [
    '"Somebody\'s been in the cellar. Crate\'s moved."',
    '"Then somebody had a reason and it\'s not ours."',
  ],
  [
    '"You think about where you\'d go? If you had to go."',
    'takes a while to answer. "No. That\'s the point of here."',
  ],
];

const NPC_BANTER = {
  // Bram Odell — keeps the genset alive.
  npc_1784515536919: [
    ...SOLO([
      '"Lights flicker, that\'s just the Reach breathing. Lights go out — then you worry."',
      'taps a gauge that isn\'t moving. "Don\'t touch the red one. I mean it."',
      '"Everything here\'s held together with wire and spite. Mostly spite."',
      '"I can keep her running. I can\'t keep her running forever. Somebody should think about that."',
    ]),
    ...RESIDENT_THREADS,
  ],
  // Marla Kest — the bar.
  npc_1784515589442: SOLO([
    '"First one\'s poured straight. After that I pour to how much I like you."',
    '"We don\'t take manifests and we don\'t take names. We take cash."',
    'wipes the bar without looking down. "Reach is small. Whatever you did out there, leave it at the door — or it leaves with you."',
  ]),
  // Amos Dune — the motel desk and the back room.
  npc_1784515608920: SOLO([
    '"Reach takes a certain kind. Haven\'t decided yet if you\'re it."',
    'rocks back a little. "Out there they\'d hang you for what gets you a handshake in here."',
    '"You want in, you don\'t ask me. You just don\'t give me a reason to say no."',
    '"Room\'s cash a night. Don\'t ask about the sixth cabin."',
  ]),
  // Cass Renner — decides who lands.
  npc_1784516450269: [
    ...SOLO([
      '"You came in on wings, so you\'ve got money or trouble. Reach only turns away one of those."',
      'thumbs the radio. "Weather\'s clear. Company isn\'t. Keep it that way."',
      '"Nobody flies out of here they didn\'t fly in as. Remember that."',
      '"I flew freight for people worse than anyone drinking in that bar. That\'s why they let me hold the door."',
    ]),
    ...RESIDENT_THREADS,
  ],
  // Doc Teller — the felt.
  npc_reach_dealer: SOLO([
    'squares the deck without looking down. "Ante\'s ante, friend. The felt doesn\'t care who you were out there."',
    '"Cards fall how they fall. Only cheat I ever caught in here, we buried facing down so he\'d keep losing."',
    'fans the deck one-handed. "Sit if you\'re sitting. The Reach doesn\'t wait, and neither do I."',
  ]),
  // Del Roan — sits down late and stays.
  npc_reach_gambler: SOLO([
    'riffles a stack of chips one-handed. "Sit down, stranger. I\'m owed a winning streak and you\'ll do fine."',
    '"Out there they fold when they\'re scared. In here we raise. It\'s more honest."',
    'grins over her cards. "No markers, Doc says. Pity. My credit\'s the only thing I\'ve got left."',
  ]),
};

// ── Apply ─────────────────────────────────────────────────────────────────────

// Re-export the rows we touched back out to content/, so git stays the source of
// truth without sweeping in the unrelated DB drift a full content:export would.
async function syncFiles(table, ids) {
  const entry = contentEntries().find(e => e.table === table);
  if (!entry) throw new Error(`no content-registry entry for ${table}`);
  const { rows } = await query(`SELECT * FROM ${table} WHERE id = ANY($1)`, [ids]);
  for (const row of rows) {
    const file = `${CONTENT_DIR}/${entry.dir || table}/${fileNameForRow(entry, row)}`;
    writeFileSync(file, canonicalJson(rowToFileObject(entry, row)), 'utf8');
  }
  return rows.length;
}

async function setAmbient(ids, lines, label) {
  if (!ids.length) return;
  const { rowCount } = await query(
    'UPDATE zones SET ambient_events = $2 WHERE id = ANY($1)', [ids, JSON.stringify(lines)]);
  console.log(`  ✓ ${label}: ${rowCount} zone(s) × ${lines.length} lines`);
}

async function main() {
  console.log('Ambience —');

  // Made ground vs. scrub. terrain is the SSOT for what the ground IS
  // (docs/reference/land-taxonomy.md), so it's also the right thing to key the
  // soundscape off — no hand-listed tile lists to drift.
  const { rows: made } = await query(
    `SELECT id FROM zones
      WHERE id LIKE 'zone_the_reach_%'
        AND flags->>'terrain' IN ('dirt', 'dirt_road')
        AND flags->>'building_type' IS NULL`);
  await setAmbient(made.map(r => r.id), TOWN, 'town street + strip approach');

  const INTERIORS = [
    [['zone_the_reach_870_1958'], FIELD,  'Buzzard Field apron'],
    [['zone_bld_899_1171_lobby'], SALOON, 'The Coyote\'s Rest'],
    [['zone_bld_899_1171_store'], STASH,  'The Stash'],
    [['zone_bld_900_1171_lobby'], MOTEL,  'The Layover office'],
    [['zone_bld_900_1171_walk1', 'zone_bld_900_1171_walk2'], WALK, 'motel walkway'],
    [['zone_bld_898_1171_lobby', 'zone_bld_898_1171_hall'],  DYNAMO, 'The Dynamo'],
  ];
  for (const [ids, lines, label] of INTERIORS) await setAmbient(ids, lines, label);

  const touchedZones = [...made.map(r => r.id), ...INTERIORS.flatMap(([ids]) => ids)];

  console.log('\nLore —');
  const { rowCount: loreN } = await query(
    `UPDATE zones SET flags = jsonb_set(COALESCE(flags, '{}'::jsonb), '{intro_lore}', $2::jsonb) WHERE id = $1`,
    [STREET_ZONE, JSON.stringify(STREET_LORE)]);
  console.log(loreN ? `  ✓ main-street arrival block on ${STREET_ZONE}` : `  ! ${STREET_ZONE} not found`);
  if (loreN) touchedZones.push(STREET_ZONE);

  console.log('\nBanter (flat strings → threads; they were being dropped) —');
  for (const [id, threads] of Object.entries(NPC_BANTER)) {
    const { rowCount } = await query('UPDATE npcs SET banter = $2 WHERE id = $1', [id, JSON.stringify(threads)]);
    if (!rowCount) { console.warn(`  ! ${id} not found — skipped`); continue; }
    const solo = threads.filter(t => t.length === 1).length;
    console.log(`  ✓ ${id}: ${threads.length} threads (${solo} solo, ${threads.length - solo} two-handers)`);
  }

  console.log('\nWriting content files —');
  console.log(`  ✓ ${await syncFiles('zones', [...new Set(touchedZones)])} zone file(s)`);
  console.log(`  ✓ ${await syncFiles('npcs', Object.keys(NPC_BANTER))} npc file(s)`);

  console.log('\nDone. Restart or /world/reload to hear it.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
