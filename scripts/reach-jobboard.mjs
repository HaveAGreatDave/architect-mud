// scripts/reach-jobboard.mjs — the Coyote's Rest work wall.
//
// The Reach had a saloon, a poker table, and no way to earn the buy-in. This
// adds the haven's OWN work: six repeatable frontier gigs, a job_boards row that
// rotates three of them, and the physical board on the saloon wall.
//
// Every zone referenced below is a real Reach zone (verified against content/):
// the strip apron, the hangar bay, the saloon cellar, the Dynamo's two floors,
// the Layover, and the dirt road between them. Nothing here leaves the Reach —
// you can't walk out, that's the point.
//
// Writes the DB *and* the matching content/*.json files, because content:import
// is additive and can't rewrite an existing row. Idempotent — safe to re-run.
//
//   node scripts/reach-jobboard.mjs                     # local dev DB
//   node --env-file=.env.prod scripts/reach-jobboard.mjs # prod

import { writeFileSync } from 'node:fs';
import { query } from '../server/models/db.js';
import { contentEntries } from '../server/models/content-registry.js';
import { CONTENT_DIR, canonicalJson, fileNameForRow, rowToFileObject } from './content/lib.mjs';

const STAMP = 1784600000;

const obj = (id, zone, desc, emotes, requires) => ({
  desc, emotes, id, type: 'visit', zone, taskSeconds: 5,
  ...(requires ? { requires } : {}),
});

const QUESTS = [
  {
    id: 'quest_reach_nolabel',
    name: 'Nothing To Declare',
    description: 'There\'s a crate in the Stash with no markings on it, and Marla would like it to be at the field instead of under her bar. Take it out through town and leave it on the apron. Nobody will ask you what\'s in it, and you will extend the same courtesy. 25₵.',
    rewards: { credits: 25 },
    objectives: [
      obj('o0', 'zone_bld_899_1171_store', 'The Stash',
        [
          '{who} gets a shoulder under the unmarked crate and lifts. It is heavier than a crate that size has any business being.',
          '{who} checks all six sides of the crate for a label, finds nothing, and stops looking.',
          '{who} hauls the crate off the cellar floor. Something inside it shifts once and then goes very still.',
        ]),
      obj('o1', 'zone_the_reach_872_1955', 'The dirt street',
        [
          '{who} carries the crate down the middle of the street. Two people watch, and neither of them says a word.',
          '{who} shifts the crate to the other shoulder and keeps walking, eyes on the road.',
          '{who} passes a doorway. Whoever is in it steps back out of the light.',
        ], ['o0']),
      obj('o2', 'zone_the_reach_870_1958', 'Buzzard Field',
        [
          '{who} sets the crate down on the apron, well clear of the fuel bowser, and walks away from it.',
          '{who} leaves the crate on the hardpan and does not look back at it. That\'s the whole job.',
          '{who} lowers the crate onto the apron, straightens up, and decides they were never here.',
        ], ['o1']),
    ],
  },
  {
    id: 'quest_reach_pallet',
    name: 'One Pallet Short',
    description: 'Cass counted the freight off a night arrival and came up one pallet light. It didn\'t fly away. Walk the apron, walk the scrub past the threshold, then go tell the hangar what you found — or didn\'t. 22₵.',
    rewards: { credits: 22 },
    objectives: [
      obj('o0', 'zone_the_reach_870_1958', 'The apron',
        [
          '{who} paces the apron reading fuel stains like a tracker, looking for where a pallet sat and then didn\'t.',
          '{who} finds a rectangle of clean hardpan where something heavy stood all night. Drag marks lead west.',
          '{who} counts the tie-down rings twice. The arithmetic keeps coming out one short.',
        ]),
      obj('o1', 'zone_the_reach_869_1958', 'The scrub past the threshold',
        [
          '{who} follows the drag marks out past the threshold until the scrub eats them.',
          '{who} kicks through the brush and turns up a strap, cut clean. Not chafed. Cut.',
          '{who} squints west at four hundred miles of nothing and concedes the pallet has a head start.',
        ], ['o0']),
      obj('o2', 'zone_bld_897_1175_lobby', 'The Hangar Bay',
        [
          '{who} reports back to the hangar: it left on foot, and it had help.',
          '{who} drops the cut strap on the hangar floor and lets it make the argument.',
          '{who} explains where the marks stopped. Nobody in the Reach writes any of it down.',
        ], ['o1']),
    ],
  },
  {
    id: 'quest_reach_word',
    name: 'Word of Mouth',
    description: 'A message for a buyer staying at the Layover. Not written down, not on any deck — memorised, carried in a skull, and said once. If you get it wrong, you get it wrong out loud. 18₵.',
    rewards: { credits: 18 },
    objectives: [
      obj('o0', 'zone_the_reach_872_1955', 'The dirt street',
        [
          '{who} walks the message down the street, mouthing it over and over so it doesn\'t come apart.',
          '{who} repeats eleven words under their breath and tries not to improve any of them.',
          '{who} carries nothing at all, which out here is the most conspicuous thing you can carry.',
        ]),
      obj('o1', 'zone_bld_900_1171_lobby', 'The Layover — Front Office',
        [
          '{who} asks at the desk which cabin. The desk considers it for a long moment before answering.',
          '{who} waits at the front office while somebody decides whether the buyer is in.',
          '{who} gets a cabin number and no name, which is how the Layover prefers to do business.',
        ], ['o0']),
      obj('o2', 'zone_bld_900_1171_walk2', 'The Walkway',
        [
          '{who} says the message once, at a door, to a face that doesn\'t come all the way into the light.',
          '{who} delivers eleven words, gets a grunt, and the door closes on the rest of the conversation.',
          '{who} finishes the message and is already walking before the door is shut.',
        ], ['o1']),
    ],
  },
  {
    id: 'quest_reach_hulk',
    name: 'Picking the Bones',
    description: 'The burned-out flyer at the end of the strip has been a memorial for years. It has also been a parts bin for years, and the Reach has never seen a conflict there. Strip what\'s still good and run it into the hangar. 20₵.',
    rewards: { credits: 20 },
    objectives: [
      obj('o0', 'zone_the_reach_870_1958', 'The burned-out flyer hulk',
        [
          '{who} climbs into the black socket of the cockpit and starts cutting loose anything that still looks like a part.',
          '{who} works a scorched panel off the hulk\'s flank and finds the linkage behind it perfectly, insultingly intact.',
          '{who} braces a boot on a wing stub and pulls until something gives — the bolt, thankfully, and not the wing stub.',
          '{who} pauses over a seat frame, decides the dead won\'t mind, and takes it anyway.',
        ]),
      obj('o1', 'zone_bld_897_1175_lobby', 'The Hangar Bay',
        [
          '{who} dumps an armload of salvaged parts on the hangar floor and lets somebody else sort the good from the scrap.',
          '{who} lays the salvage out in a row, soot to the elbows, and gets paid without a receipt.',
          '{who} hands over the parts. Somewhere in the pile is a component worth more than the whole day\'s pay, and everybody knows it.',
        ], ['o0']),
    ],
  },
  {
    id: 'quest_reach_dynamo',
    name: 'Hold This, Don\'t Let Go',
    description: 'Bram needs a second pair of hands at the Dynamo, which is his way of saying he needs somebody to hold a live thing steady while he does something ill-advised to it. Switch room, then the turbine floor, then go tell the street the lights are staying on. 24₵.',
    rewards: { credits: 24 },
    objectives: [
      obj('o0', 'zone_bld_898_1171_lobby', 'The Switch Room',
        [
          '{who} holds a torch on the control board while Bram has both arms inside it up to the elbow.',
          '{who} is told to hold this and not let go, and does not let go, and does not ask what it is.',
          '{who} watches a needle drift while Bram swears at something behind the panel in two languages.',
        ]),
      obj('o1', 'zone_bld_898_1171_hall', 'The Turbine Floor',
        [
          '{who} follows a cable run onto the turbine floor with the whole building humming up through their boots.',
          '{who} braces the scavenged turbine\'s housing while Bram beats a mounting bracket back into approximately the right shape.',
          '{who} finds the fault: a taped joint that has been re-taped so many times the tape is now structural.',
        ], ['o0']),
      obj('o2', 'zone_the_reach_872_1955', 'The dirt street',
        [
          '{who} comes out into the street to report that the Reach has power, for now, on a technicality.',
          '{who} tells the first person they see that the lights are staying on. It gets around fast; there aren\'t many people.',
          '{who} stands in the road, ears still ringing from the genset, and watches a porch light come back on.',
        ], ['o1']),
    ],
  },
  {
    id: 'quest_reach_deadhead',
    name: 'Deadhead',
    description: 'Empty freight, wrong direction, on foot, because the thing that should have carried it is unserviceable and everyone here is out of favours. Hangar bay to the apron, up the road, into town. It pays because it is miserable. 30₵.',
    rewards: { credits: 30 },
    objectives: [
      obj('o0', 'zone_bld_897_1175_lobby', 'The Hangar Bay',
        [
          '{who} loads up in the hangar bay and is told, cheerfully, that it\'s not far. It is far.',
          '{who} takes the whole load in one trip out of pure spite.',
          '{who} straps the load on, looks at the door, and stops asking why nobody else volunteered.',
        ]),
      obj('o1', 'zone_the_reach_870_1958', 'The apron',
        [
          '{who} crosses the apron under the full weight of it, boots printing the hardpan.',
          '{who} passes the fuel bowser and considers, briefly, setting the whole load down and living here.',
          '{who} rebalances the load beside the dead windsock and pushes on.',
        ], ['o0']),
      obj('o2', 'zone_the_reach_871_1958', 'The road east',
        [
          '{who} grinds east up the road with the heat coming off it in a sheet.',
          '{who} is now carrying the load in a way that is bad for their back and good for their pace.',
          '{who} counts buildings on the horizon. There are four. There have always been four.',
        ], ['o1']),
      obj('o3', 'zone_the_reach_872_1955', 'The dirt street',
        [
          '{who} drops the load in the street and stands over it, breathing like a man who has just argued with geography.',
          '{who} sets the freight down in town and swears never again, in the tone of somebody who will be back tomorrow.',
          '{who} arrives, unloads, and is handed a drink they did not order and absolutely need.',
        ], ['o2']),
    ],
  },
];

const BOARD = {
  id: 'board_coyotes_rest',
  zone_id: 'zone_bld_899_1171_lobby',
  name: 'The Coyote\'s Rest — Work Nobody Signs For',
  description: 'Whatever the Reach needs doing this week. No contracts, no manifests, no names — take a card off the wall, do the thing, come back and Marla pays you out of the till. Nobody will ever ask you what was in it.',
  quest_pool: QUESTS.map(q => q.id),
  rotation_size: 3,
  rotation_period: 21600,
};

const BOARD_FURNITURE = {
  id: 'furn_reach_jobboard',
  zone_id: 'zone_bld_899_1171_lobby',
  name: 'the work wall',
  description: 'A stretch of bare planking beside the bar, shingled in index cards, torn envelope backs and one whole ration label, each one held on by whatever was to hand — a nail, a knife, in one case a spent round hammered flat. Nothing on it is signed. Nothing on it says who is paying, only what needs doing and where. Read the wall (or type gigs) to see what\'s posted.',
  flags: { job_board: true },
  object_type: 'decoration',
};

// ── Apply ─────────────────────────────────────────────────────────────────────

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

async function main() {
  // Fail loudly rather than shipping a dangling objective: every zone an
  // objective points at (and the board's own zone) has to actually exist.
  const zoneIds = [...new Set([
    BOARD.zone_id,
    ...QUESTS.flatMap(q => q.objectives.map(o => o.zone)),
  ])];
  const { rows: found } = await query('SELECT id FROM zones WHERE id = ANY($1)', [zoneIds]);
  const missing = zoneIds.filter(z => !found.some(r => r.id === z));
  if (missing.length) throw new Error(`zones do not exist: ${missing.join(', ')}`);
  console.log(`Zone refs — ✓ all ${zoneIds.length} resolve`);

  console.log('\nGigs —');
  for (const q of QUESTS) {
    await query(
      `INSERT INTO quests (id, name, description, objectives, rewards, repeatable, quest_type, meta, category, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1, 'standard', '{}'::jsonb, 'Job Board', $6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         objectives = EXCLUDED.objectives, rewards = EXCLUDED.rewards,
         repeatable = EXCLUDED.repeatable, category = EXCLUDED.category,
         updated_at = EXCLUDED.updated_at`,
      [q.id, q.name, q.description, JSON.stringify(q.objectives), JSON.stringify(q.rewards), STAMP]);
    console.log(`  ✓ ${q.id} — ${q.name} (${q.objectives.length} obj, ${q.rewards.credits}₵)`);
  }

  console.log('\nBoard —');
  await query(
    `INSERT INTO job_boards (id, zone_id, name, description, quest_pool, rotation_size, rotation_period, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       zone_id = EXCLUDED.zone_id, name = EXCLUDED.name, description = EXCLUDED.description,
       quest_pool = EXCLUDED.quest_pool, rotation_size = EXCLUDED.rotation_size,
       rotation_period = EXCLUDED.rotation_period, updated_at = EXCLUDED.updated_at`,
    [BOARD.id, BOARD.zone_id, BOARD.name, BOARD.description, JSON.stringify(BOARD.quest_pool),
      BOARD.rotation_size, BOARD.rotation_period, STAMP]);
  console.log(`  ✓ ${BOARD.id} — ${BOARD.quest_pool.length} in pool, ${BOARD.rotation_size} rotate every ${BOARD.rotation_period}s`);
  // Drop any cached rotation so the new pool shows on the next read.
  await query('DELETE FROM world_flags WHERE flag_key = $1', [`jobboard_rot_${BOARD.id}`]);

  console.log('\nFurniture —');
  const f = BOARD_FURNITURE;
  await query(
    `INSERT INTO furniture (id, zone_id, name, description, flags, object_type)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       zone_id = EXCLUDED.zone_id, name = EXCLUDED.name, description = EXCLUDED.description,
       flags = EXCLUDED.flags, object_type = EXCLUDED.object_type`,
    [f.id, f.zone_id, f.name, f.description, JSON.stringify(f.flags), f.object_type]);
  console.log(`  ✓ ${f.id} in ${f.zone_id}`);

  console.log('\nWriting content files —');
  console.log(`  ✓ ${await syncFiles('quests', QUESTS.map(q => q.id))} quest file(s)`);
  console.log(`  ✓ ${await syncFiles('job_boards', [BOARD.id])} job_board file(s)`);
  console.log(`  ✓ ${await syncFiles('furniture', [f.id])} furniture file(s)`);

  console.log('\nDone. Restart or /world/reload, then read the wall in the Coyote\'s Rest.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
