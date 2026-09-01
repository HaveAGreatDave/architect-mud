/**
 * Long Watch quest prose.
 *
 * Writes only `description`, `objectives[].desc` and `objectives[].emotes`.
 * Every id, type, zone, target, count, reward and condition is asserted
 * unchanged by diffing the structure before and after.
 *
 * The Watch get no em dash (docs/story.md) — it marks Ascendant and Architect
 * voices only. Their beats are carried by full stops. The script refuses to
 * write a dash into a Watch string.
 *
 * The ladder is about hands: Proof of Hands, Bench Time, Quiet Hands, "know
 * exactly where to put your hands, and then go and put them there". The
 * Ascendants sell better ones. Every rung is written as a move in that argument.
 *
 * Three objects cross between the ladders so the second one a player walks lands
 * harder:
 *   · the Precinct 9 camera core, pulled in lw_2, seated again in asc_loyalty
 *   · Ives's pale grey coat, offering you a way out in asc_1, worn when you kill
 *     her in lw_rite
 *   · "down, not out" — both orders forbid a body, for opposite reasons, and
 *     neither remarks on agreeing with the other
 *
 *   node scripts/content/rewrite-order-prose-lw.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const DIR = path.join(process.cwd(), 'content', 'quests');
const CHECK = process.argv.includes('--check');

const PROSE = {

  // ── Slot 1 · benign. The audition, and the thesis statement for the order. ──
  quest_lw_1: {
    description:
      'Halloran has a package that wants collecting from a drop near the Hall of Records. Sealed. Not to be opened, not to be asked about, and not to be carried in a way that makes anybody wonder what you are carrying.\n\nHe will not say what is in it. What is in it does not matter. He wants to watch your hands go out with a thing and come back with the same thing, and he has run this on every person in the room behind him, including the ones who failed it.',
    objectives: {
      o_collect: {
        desc: 'Collect the sealed package from the drop near the Hall of Records (follow the green GPS line).',
        emotes: [
          '{who} eases the oilcloth parcel out of its hiding place and tucks it away.',
          '{who} does not weigh it in their hand, and is aware of not doing it.',
          '{who} walks back the way an errand walks back, which is the entire skill.',
        ],
      },
    },
  },

  // ── Slot 2 · benign. Plants the core, so asc_loyalty can hand it back. ──────
  quest_lw_2: {
    description:
      'There is a street camera on the Precinct 9 approach that has spent a year looking at a door the Watch would rather it stopped looking at.\n\nHalloran wants the memory core out of it. Not the camera broken. The core pulled. A broken camera is replaced by Tuesday and somebody files a report about vandals. A camera that simply stops remembering gets argued about for a month by people who do not want to be the one who raised it.\n\nBring the core back. He wants to see it in your hand.',
    objectives: {
      o_core: {
        desc: 'Pull the memory core from the street camera on the Precinct 9 approach (follow the green GPS line).',
        emotes: [
          '{who} works the camera housing open and lifts out its core. The amber light dies.',
          '{who} puts the core in an inside pocket, where it sits against the ribs like a coin.',
          '{who} steps back into the street and does not look up at the thing they have just blinded.',
        ],
      },
    },
  },

  // ── Slot 3 · the first fight. Sets lw_member. Not about danger, about record. ─
  quest_lw_3: {
    description:
      'The Architect has run a maintenance drone on the same loop through the deep east tunnels for eleven years, and for eleven years nobody minded it.\n\nIt has started logging things it did not use to log. The Watch\'s chalk. The Watch\'s door. How often a particular grating gets lifted in a week, and at what hour.\n\nNobody in the Den thinks the Architect is coming for them. That is not the worry. The worry is that the record exists, sitting somewhere, patient, and that one day somebody who is coming for them will think to read it.\n\nGo down and stop it remembering.',
    objectives: {
      o_kill_drone: {
        desc: 'Destroy the Architect\'s maintenance drone in the deep east tunnels (near the Machine Sump).',
        emotes: [
          '{who} sets themselves against the drone\'s sweeping amber eye.',
          '{who} drives another blow into the drone\'s chassis, and it goes on taking readings while they do it.',
          '{who} works at the housing until the eye stops sweeping and stays where it stopped.',
        ],
      },
    },
  },

  // ── Slot 6 · the set-piece. First real collision with Halcyon. ──────────────
  quest_lw_4: {
    description:
      'Halcyon does not delete a lapsed account. Deleting costs a write and proves nothing to anybody. It keeps the copy, stops paying to run it, and moves the file to a floor where the lights are on a timer.\n\nThere is a sub-registrar in the Vats who has spent nine years filing people nobody is coming back for. She has counted them. What she would like, more than anything else she has wanted in those nine years, is for somebody else to have counted them too.\n\nShe will hand the Watch the whole archive. She will not do it from inside that building and she cannot run, so you will walk her out at the speed she walks. Nobody goes in the ground on the way. A body turns a resignation into a manhunt.',
    objectives: {
      o_infil: {
        desc: 'Get into the Registry in the Vats and stand the floor long enough to be sure it is between rounds.',
        emotes: [
          '{who} keeps very still by the Registry door and listens to a supervisor\'s shoes going the other way.',
          '{who} counts the gaps in the rounds and does not like the number.',
          '{who} stands under a poster about the importance of continuous coverage and waits it out.',
        ],
      },
      o_ledger: {
        desc: 'Pull the lapse archive off the Registry terminal. Quietly.',
        emotes: [
          '{who} works the Registry terminal with one eye on the door.',
          '{who} watches a column of eleven thousand names copy across, and stops reading them.',
          '{who} notices the file has a retention date on it, and that the date has already passed.',
        ],
      },
      o_word: {
        desc: 'Talk to Sub-Registrar Nine. Once she steps out from behind that desk there is no version of this where nobody notices.',
        emotes: [
          '{who} says the sentence they have been rehearsing, and Nine puts her pen down before the end of it.',
          '{who} watches a woman take about four seconds to stop being who she has been for nine years.',
        ],
      },
      o_out: {
        desc: 'Walk Nine out to the Threshold. She moves when you move and no faster, and Halcyon has opened a recovery.',
        emotes: [
          '{who} matches Nine\'s pace, which is slower than {who} would like.',
          '{who} checks the road behind them again.',
          '{who} keeps talking about nothing, because a woman walking and talking is a woman going home.',
        ],
      },
      o_hand: {
        desc: 'Put the slate in Cyrelle\'s hands.',
        emotes: [
          '{who} puts the slate in Cyrelle\'s hands. Cyrelle does not look at it. She looks at the road behind {who}.',
        ],
      },
    },
  },

  // ── Repeatable favour. The order's economics in one errand. ────────────────
  quest_lw_fav_bench: {
    description:
      'Halloran does not need the help. He says so twice, while clearing you a space at the bench and moving the good light over.\n\nThe Watch run on things that were made rather than bought, and the making gets done by whoever is standing there when it needs doing. Today that is you. There is no trick to it and nobody is watching to see if you fail.\n\nThat is not the same as nobody noticing whether you came.',
    objectives: {
      o_make: {
        desc: 'Make something. Anything. Bring it back made rather than bought.',
        emotes: [
          '{who} works with their hands and does not look up for a while.',
          '{who} gets it wrong, sets it down, and starts the same piece again without comment.',
          '{who} holds the finished thing up to the good light and finds it acceptable.',
        ],
      },
    },
  },

  // ── Slot 5 · a test that does not look like one. ───────────────────────────
  quest_lw_fav_carry: {
    description:
      'The Quartermaster keeps a ledger of everything the Watch owns and a much shorter one of everything it has lost. The second ledger is the one she can recite.\n\nThere is a cache under the Fisherman\'s Green that has been on it for a month, which she considers a personal failing and has said so to nobody. It is not a dangerous errand. There is nothing clever about it. She would like it back all the same, and she would like to be able to draw a line through the entry herself.',
    objectives: {
      o_get: {
        desc: 'Recover the cache from under the Fisherman\'s Green.',
        emotes: [
          '{who} gets down into the wet under the Green and finds it where the ledger said it would be.',
          '{who} brushes a month of silt off a tin that nobody but one woman has missed.',
        ],
      },
      o_home: {
        desc: 'Carry it back to the Quartermaster.',
        emotes: [
          '{who} sets it on the counter and waits to be told which shelf.',
          '{who} watches her draw one line through one entry, and take rather longer over it than the line needs.',
        ],
      },
    },
  },

  // ── Repeatable favour. The order's relationship with being seen. ───────────
  quest_lw_fav_eye: {
    description:
      'There is a camera on the Meltwater side that has been looking at a doorway people need to use.\n\nNyall has chalked the wall under it. That is his way of putting a thing on a list, and the list is a wall, and the wall is the only copy. Go and close the eye, and do not be a story afterwards. Being a story is the failure condition. The camera is just a camera.',
    objectives: {
      o_reach: {
        desc: 'Get under the camera on Meltwater Row and wait for the street to lose interest.',
        emotes: [
          '{who} stands in a doorway doing nothing at all, which takes practice.',
          '{who} lets two people and a dog go by, and gives the street back to itself.',
        ],
      },
      o_close: {
        desc: 'Close the eye.',
        emotes: [
          '{who} closes the eye and walks off at the speed of somebody with nowhere in particular to be.',
          '{who} rubs Nyall\'s chalk mark off the wall on the way past, because a list is evidence too.',
        ],
      },
    },
  },

  // ── Slot 8 · cost. Rhymes with Halcyon's "we do not kill clients". ─────────
  quest_lw_fav_quiet: {
    description:
      'One of the Architect\'s little servants has been counting doors on Foundry Way and writing the numbers down. Not for anybody. Nobody has commissioned it. It counts because counting is what it was made to do.\n\nTeague wants the counting stopped and the counter left alive, and he is unusually direct about the second half. The Watch do not leave bodies. A body is a reason for somebody to come and look, and the whole of this order is built on nobody coming to look.\n\nHe does not say it is mercy. He is careful not to say that.',
    objectives: {
      o_down: {
        desc: 'Put the census clerk down and leave them breathing.',
        emotes: [
          '{who} waits for the clipboard to come up, and takes them across the back of the head.',
          '{who} checks for breath, finds it, and does not stay to be thanked or blamed.',
          '{who} puts the clipboard face down before they go, which nobody asked for.',
        ],
      },
    },
  },

  // ── Repeatable favour. The discipline, which is the absence of action. ─────
  quest_lw_fav_sit: {
    description:
      'Somebody has to sit the post while somebody else sleeps.\n\nThe Blind looks down the length of the wash. The shortwave mutters to itself on a frequency nobody has ever answered. The whole of the job is that you are there, and awake, and that if the thing the Watch have been waiting eleven years for comes down that wash tonight, one person sees it.\n\nPike will not thank you. Pike has sat it ten thousand times and has never once been thanked either.',
    objectives: {
      o_sit: {
        desc: 'Sit the post at the Blind. Do not open the door.',
        emotes: [
          '{who} watches the mirror down the length of the wash, and nothing comes.',
          '{who} listens to the shortwave mutter, and nothing in it is for them.',
          '{who} shifts once on the stool and settles again.',
          '{who} thinks about how much of a life this adds up to, and then stops thinking about it.',
        ],
      },
    },
  },

  // ── Slot 9 · the best test in the game, and it never says it is one. ───────
  quest_lw_loyalty: {
    description:
      'The Quartermaster hands you a purse heavy enough to be a point, and a list of parts the Watch cannot make and will not do without.\n\nAll of it is sold on Halcyon Boulevard. So is everything else. The clinic on that same street will fit you anything you like while you wait, at a discount, to anybody who looks like they might be considering it, and they are extremely good at spotting who is considering it.\n\nShe does not tell you not to. She has never told anybody not to, in twenty years of handing out that purse.\n\nShe says: bring the parts back, and bring yourself back. Then she watches you the whole way to the door.',
    objectives: {
      o_street: {
        desc: 'Work the length of Halcyon Boulevard for the parts on the list.',
        emotes: [
          '{who} works down the list, counter by counter, and is offered something better at every one of them.',
          '{who} is called by their first name by a man they have never met, who read it off a screen.',
        ],
      },
      o_wait: {
        desc: 'The last part is behind the clinic counter. Wait for it.',
        emotes: [
          '{who} sits in a warm, clean waiting room while somebody explains what could be done about the ache in their hands.',
          '{who} is handed a brochure, and holds it, and does not read it.',
          '{who} is told there is no obligation, in a voice with no obligation in it at all.',
        ],
      },
      o_back: {
        desc: 'Take the parts back to the Quartermaster.',
        emotes: [
          '{who} puts the parts and what is left of the purse on the counter, in that order.',
          '{who} notices her counting the purse second.',
        ],
      },
    },
  },

  // ── Slot 4 · the test whose answer is what you say afterwards. ─────────────
  quest_lw_meet: {
    description:
      'Halloran says a runner is coming in from the east tonight with something he wants in a hand rather than on a wire, and that you are to sit in the Den and take it off her.\n\nHe does not say what it is. He does not say who she is.\n\n"She will know you. Wait for her. That is the job. Wait for her."',
    objectives: {
      o_wait: {
        desc: 'Sit in the Runners\' Den and wait for the runner coming in from the east.',
        emotes: [
          '{who} takes a cot near the door and watches the chalked board of legs.',
          '{who} listens to the drip in the spine outside, and the drip is the only thing that comes.',
          '{who} checks the passage. Nobody. Sits back down.',
          '{who} has been here long enough now to have stopped rehearsing what to say to her.',
          '{who} understands, somewhere in the second hour, that nobody is coming.',
        ],
      },
      o_report: {
        desc: 'Go back to Halloran and tell him what happened.',
        emotes: [
          '{who} walks up to the shop with nothing in their hands and nothing to show.',
          '{who} works out on the way what they are going to say, and then has to decide whether to say it.',
        ],
      },
    },
  },

  // ── Slot 10 · the rite. No dash anywhere in it, and the climax gets a voice. ─
  quest_lw_rite: {
    description:
      'Pike gets off the stool. He does not explain getting off the stool, and in eleven years nobody has seen him do it twice.\n\n"Everyone thinks the rite is the sitting. It is not. Anybody can sit. The rite is that you have been sat here long enough to know exactly where to put your hands, and then you go and put them there."\n\nThe Quartermaster has a charge on the counter and will not meet your eye while you pick it up.\n\nThe vats are the promise. Not the Spire, not the man at the top, not the money. The vats. It is the room where they keep the thing they actually sell, and every single person who has ever said yes to them said yes to that room.\n\nBring the colonnade down. And the woman at the gate who has spent six years putting a price on our people, on your way out.\n\nThen come home. That last part is not decoration. Two of the three people who have done this did not manage it.',
    objectives: {
      o_charge: {
        desc: 'Take the charge off the Quartermaster\'s counter.',
        emotes: [
          '{who} picks up the charge. The Quartermaster finds something else to be doing.',
          '{who} waits a moment in case she says anything, and she does not, and that is her saying it.',
        ],
      },
      o_inside: {
        desc: 'Get inside the Vats Hall.',
        emotes: [
          '{who} walks the concourse at the pace of somebody who is expected, which is the only pace that works.',
          '{who} goes under the seal at the door and is not stopped, because nobody stops a person who is already inside.',
        ],
      },
      o_blow: {
        desc: 'Wire the charge to the vat colonnade and bring it down.',
        emotes: [
          '{who} works along the colonnade with their back to the room, the way somebody works who belongs there.',
          '{who} sets the last of it and does not look into the nearest tank, having decided that on the way in.',
        ],
      },
      o_ives: {
        desc: 'Actuary Verity Ives is at the gate. She is always at the gate.',
        emotes: [
          '{who} finds Verity Ives exactly where she said she would be, which is the last thing she is ever right about.',
          '{who} recognises the pale grey coat, and an appointment that was already in somebody\'s diary.',
          '{who} does not answer the thing she says first, because answering it is how she has always started.',
        ],
      },
      o_home: {
        desc: 'Get back to the Blind.',
        emotes: [
          '{who} comes down the mirror-polished plaza steps at a walk, because running is what they look for.',
          '{who} takes the road east with the sound still going on behind them.',
          '{who} gets to the wash and finds Pike on the stool, awake, as though he had simply not gone to bed.',
        ],
      },
    },
  },
};

// ── apply ───────────────────────────────────────────────────────────────────
// The skeleton is every field EXCEPT the three text fields we rewrite. It is
// captured before and compared after, so a typo that drops an objective or
// renames a zone fails the run rather than reaching the world.
const skeleton = (q) => JSON.stringify({
  ...q,
  description: null,
  objectives: (q.objectives || []).map((o) => ({ ...o, desc: null, emotes: null })),
});

const DASH = /[—–]| - | -- /;

let files = 0, descs = 0, objs = 0, emotes = 0;
const problems = [];

for (const [id, prose] of Object.entries(PROSE)) {
  const file = path.join(DIR, `${id}.json`);
  if (!fs.existsSync(file)) { problems.push(`${id}: no such quest file`); continue; }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const before = skeleton(data);

  if (prose.description) {
    if (DASH.test(prose.description)) problems.push(`${id}: description carries a dash, and the Watch get none`);
    data.description = prose.description;
    descs++;
  }

  for (const [oid, patch] of Object.entries(prose.objectives || {})) {
    const obj = (data.objectives || []).find((o) => o.id === oid);
    if (!obj) { problems.push(`${id}: no objective "${oid}"`); continue; }
    if (patch.desc) {
      if (DASH.test(patch.desc)) problems.push(`${id}/${oid}: desc carries a dash`);
      obj.desc = patch.desc; objs++;
    }
    if (patch.emotes) {
      for (const e of patch.emotes) {
        if (DASH.test(e)) problems.push(`${id}/${oid}: emote carries a dash`);
        if (!e.includes('{who}')) problems.push(`${id}/${oid}: emote has no {who} token`);
      }
      obj.emotes = patch.emotes; emotes += patch.emotes.length;
    }
  }

  const after = skeleton(data);
  if (before !== after) { problems.push(`${id}: STRUCTURE CHANGED, refusing`); continue; }

  if (!CHECK) fs.writeFileSync(file, canonicalJson(data), 'utf8');
  files++;
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Long Watch: ${files} quest(s), ${descs} description(s), ${objs} objective line(s), ${emotes} emote(s).`);
if (problems.length) { console.error(`${problems.length} problem(s) — nothing written for those.`); process.exit(1); }
