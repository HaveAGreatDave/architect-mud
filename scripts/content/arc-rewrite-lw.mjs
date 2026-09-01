/**
 * The Long Watch, slots 1-10 — rewritten as the FIRST QUARTER of a forty-slot
 * ladder rather than as a complete story.
 *
 * Three things drive this pass, all of them out of the craft section of
 * docs/reference/plain-writing.md:
 *
 * 1. NOTHING RESOLVES AT SLOT 10. The Iron Heel breaks off mid-sentence; the
 *    Sleeper ends mid-fall. A rite that settles the war leaves thirty slots with
 *    nothing to be about. So the rite stops being an assassination (below) and
 *    becomes an entry with a price.
 *
 * 2. THE WORLD IS BIGGER THAN TWO ORDERS. Graham asks whether the city still has
 *    a police force and is told "Several", and then "About fourteen" — no
 *    explanation, and the whole shape of the government arrives on the number.
 *    Nobody here explains what else is out there either; two people decline to,
 *    briefly, and move on. No line may imply the field is binary.
 *
 * 3. THE VOICE CHANGES ACROSS THE LADDER. Zamyatin proves a character has
 *    changed by changing the prose, never by announcing it. Slots 1-3 are
 *    addressed to a stranger, 4-6 to a useful pair of hands, 7-9 to somebody
 *    with something to lose, 10 to one of us. Nobody remarks on it.
 *
 * The Watch gets no euphemisms at all. That is the whole contrast with the
 * Ascendants, who have nothing else, and it is why every line here is blunt and
 * every line over there is warm and correct.
 *
 * OBJECTIVE CHANGE (one, deliberate):
 *   quest_lw_rite `o_ives` : assassinate -> talk.
 *   Killing Verity Ives at slot 10 spends the best Ascendant voice in the game a
 *   quarter of the way through a forty-slot ladder, and turns a door into a
 *   finale. She now speaks to you at the gate and you get past her. What a
 *   player does after she has finished speaking is not an objective either way.
 *   ⚠ trigger_lw_rite_pursuit fires on `demolition.detonated` in the vat hall,
 *   NOT on the kill, so the escape — the part that actually kills people — is
 *   untouched by this.
 *
 *   node scripts/content/arc-rewrite-lw.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const QUESTS = path.join(process.cwd(), 'content', 'quests');
const CHECK = process.argv.includes('--check');

// The Watch does not get em dashes. That is an Ascendant and Architect tell, and
// it is the loudest thing separating the two ladders on the page.
const DASH = /[—–]/;

const Q = {

  // ═══ 1 · PROOF OF HANDS ══════════════════════════════════════════════════
  // Carries the bill inside the opening, De Quincey style: Halloran names the
  // part of the job people fail, nine slots before the rite tests it.
  quest_lw_1: {
    description:
      "Halloran has a package sitting in a drop near the Hall of Records. Sealed. Not to be opened, not to be asked about, and not to be carried in a way that makes anybody wonder what you are carrying.\n\n" +
      "He will not say what is in it. What is in it does not matter. He wants to watch a pair of hands go out with a thing and come back with the same thing.\n\n" +
      "\"Last part is the coming back,\" he says, not looking up from the bench. \"People are fine right up until the coming back.\"",
    objectives: {
      o_collect: {
        desc: "Collect the sealed package from the drop near the Hall of Records (follow the green GPS line).",
        emotes: [
          "{who} eases the oilcloth parcel out of its hiding place and tucks it away.",
          "{who} does not weigh it in their hand, and is aware of not doing it.",
          "{who} walks back the way an errand walks back.",
        ],
      },
    },
  },

  // ═══ 2 · BLIND SPOT ══════════════════════════════════════════════════════
  // The first evasion. Where the part came from is a question with a short
  // answer and nothing after it.
  quest_lw_2: {
    description:
      "A dead camera on Kessler needs a part the Watch cannot make. Halloran has one put by, two streets over, behind a panel that has not been opened since the last time somebody needed it.\n\n" +
      "You ask who else makes them, since he has just finished saying the Watch does not.\n\n" +
      "\"Three that I know of.\"\n\n" +
      "You wait for the names. They do not come, and he goes back to the bench.",
    objectives: {
      o_core: {
        desc: "Recover the camera core from the panel cache two streets over.",
        emotes: [
          "{who} gets the panel off without marking it, which is most of the job.",
          "{who} finds the core exactly where a thing is when nobody has been at it.",
          "{who} closes the panel and stands there a second, checking it looks unopened.",
        ],
      },
    },
  },

  // ═══ 3 · GHOST IN THE WORKS ══════════════════════════════════════════════
  // The first fight. The Watch draws the line out loud once and never again.
  quest_lw_3: {
    description:
      "Something is running the ducts under the wash and it is not maintenance. It has been mapping the Blind for eleven days, patiently, in the small hours, the way a thing works when nobody has told it to hurry.\n\n" +
      "Halloran wants it stopped, and he wants it stopped in a way that leaves pieces.\n\n" +
      "\"It is a machine,\" he says. \"I am telling you that so you do not go looking for a reason. It has not got one. Somebody else has the reason and they are not down here.\"",
    objectives: {
      o_kill_drone: {
        desc: "Find the surveyor drone in the ducts under the wash and destroy it.",
        emotes: [
          "{who} follows the noise of it through two junctions and waits at the third.",
          "{who} gets a hand to it before it can climb, which is the only part that was ever going to work.",
          "{who} pulls the optics out of the wreck and pockets them without being asked to.",
        ],
      },
    },
  },

  // ═══ 4 · THE MEET ════════════════════════════════════════════════════════
  // Both answers turn the quest in. The waiting is the training, the report is
  // the test, and neither is announced.
  quest_lw_meet: {
    description:
      "Halloran says a runner is coming in from the east tonight with something he wants in a hand rather than on a wire, and that you are to sit in the Den and take it off her.\n\n" +
      "He does not say what it is. He does not say who she is.\n\n" +
      "\"She will know you. Wait for her. That is the job. Wait for her.\"",
    objectives: {
      o_wait: {
        desc: "Sit in the Runners' Den and wait for the runner coming in from the east.",
        emotes: [
          "{who} takes a cot near the door and watches the chalked board of legs.",
          "{who} listens to the drip in the spine outside, and the drip is the only thing that comes.",
          "{who} checks the passage. Nobody. Sits back down.",
          "{who} has been here long enough now to have stopped rehearsing what to say to her.",
          "{who} understands, somewhere in the second hour, that nobody is coming.",
        ],
      },
      o_report: {
        desc: "Go back to Halloran and tell him what happened.",
        emotes: [
          "{who} walks up to the shop with nothing in their hands and nothing to show.",
          "{who} works out on the way what they are going to say, and then has to decide whether to say it.",
        ],
      },
    },
  },

  // ═══ 5 · CARRY IT BACK ═══════════════════════════════════════════════════
  // Slot 1 again, with a real temptation in it. The catch is mentioned once, in
  // passing, and never returned to.
  quest_lw_fav_carry: {
    description:
      "A case wants moving from a lock-up off the Yards to the Blind, and the Quartermaster would rather it went across town in a hand than on any wire in this city.\n\n" +
      "It is not heavy. It is not fastened either, which she mentions on the way past and does not come back to.\n\n" +
      "\"Straight through,\" she says. \"If it goes wrong, put it down and walk. It is worth less than you are, and I will only say that once.\"",
    objectives: {
      o_get: {
        desc: "Collect the case from the lock-up off the Yards.",
        emotes: [
          "{who} finds the lock-up by its number, and the number by counting, because none of them are lit.",
          "{who} lifts the case and finds the catch is not fastened.",
          "{who} spends about four seconds deciding, and then walks.",
        ],
      },
      o_home: {
        desc: "Carry the case back to the Blind.",
        emotes: [
          "{who} takes the long way round the market rather than the short way through it.",
          "{who} changes hands at the bridge and keeps going.",
          "{who} puts the case on the counter with the catch exactly as it was.",
        ],
      },
    },
  },

  // ═══ 6 · RETENTION ═══════════════════════════════════════════════════════
  // The set piece, and the first time the player meets somebody who took the
  // Ascendant offer. Nine is not a warning. He is tired, and he liked the
  // dentistry, and both of those are true at once.
  quest_lw_4: {
    description:
      "There is a clerk in the Vats Registry called Nine who has been sending the Watch small true things for four months, and this morning he sent one word.\n\n" +
      "The Quartermaster does not dress it up. He is a clerk. He is not brave. He has an eleven-year account and about two hours before somebody upstairs reads the log she has just read.\n\n" +
      "\"Get in, get his file off the ledger, get him out on his feet. He will want to talk on the way. Let him.\"",
    objectives: {
      o_infil: {
        desc: "Get into the Registry in the Vats and stand the floor long enough to be sure it is between rounds.",
        emotes: [
          "{who} keeps very still by the Registry door and listens to a supervisor's shoes going the other way.",
          "{who} counts the gaps in the rounds and does not like the number.",
          "{who} stands under a poster about the importance of continuous coverage and waits it out.",
        ],
      },
      o_ledger: {
        desc: "Pull Nine's file off the Registry ledger.",
        emotes: [
          "{who} finds the account in nineteen seconds, because it is filed exactly where an account is filed.",
          "{who} reads two lines of an eleven-year record and stops reading.",
          "{who} takes the file and leaves the drawer open, having decided open is faster than tidy.",
        ],
      },
      o_word: {
        desc: "Find Nine and give him the word.",
        emotes: [
          "{who} says the word and watches a man decide, in about a second, that he meant it four months ago.",
          "{who} waits while he puts the cover on his terminal, which is not necessary and takes him nine seconds.",
        ],
      },
      o_out: {
        desc: "Walk Nine out of the Vats.",
        emotes: [
          "{who} keeps a pace ahead of him and does not turn round at the sound of his breathing.",
          "{who} listens to him explain, quietly and at length, that the coverage was genuinely very good.",
          "{who} hears him work out aloud that he does not know what he is going to do about his teeth now.",
          "{who} gets him through the last door and finds he has stopped talking on his own.",
        ],
      },
      o_hand: {
        desc: "Hand Nine and his file over at the Blind.",
        emotes: [
          "{who} puts the file on the counter and a man beside it, in that order, because that is the order they were asked for.",
        ],
      },
    },
  },

  // ═══ 8 · QUIET HANDS ═════════════════════════════════════════════════════
  // Cost. The first job that takes something from somebody who did nothing.
  quest_lw_fav_quiet: {
    description:
      "A counter clerk in Civic signs off the camera maintenance schedule for four districts, and on Thursday he signs the one that puts eyes on the wash.\n\n" +
      "Halloran wants him face down in a stairwell for twenty minutes and breathing at the end of it. Not hurt past mending. Not robbed. Not spoken to.\n\n" +
      "\"He is a clerk with a bad back and a dog,\" he says. \"None of that is a reason to do it and none of it is a reason not to. I am telling you so he does not surprise you.\"",
    objectives: {
      o_down: {
        desc: "Put the Civic counter clerk down, and leave him breathing.",
        emotes: [
          "{who} waits in the stairwell for a man who takes the stairs because of the lifts, every day, at the same time.",
          "{who} does it fast, which is the kindest available way of doing it.",
          "{who} turns him onto his side before leaving, which nobody asked for.",
        ],
      },
    },
  },

  // ═══ 9 · NOTHING BOUGHT ══════════════════════════════════════════════════
  // The best test in the ladder and it still never says it is one. The clinic
  // quotes a figure, and the figure is less than what is in the purse; the
  // arithmetic does the work and nobody in the scene remarks on it.
  quest_lw_loyalty: {
    description:
      "The Quartermaster hands you a purse heavy enough to be a point, and a list of parts the Watch cannot make and will not do without.\n\n" +
      "All of it is sold on Halcyon Boulevard. So is everything else. The clinic on that same street will fit you anything you like while you wait, at a discount, to anybody who looks like they might be considering it, and they are extremely good at spotting who is considering it.\n\n" +
      "She does not tell you not to. She has never told anybody not to, in twenty years of handing out that purse.\n\n" +
      "She says: bring the parts back, and bring yourself back. Then she watches you the whole way to the door.",
    objectives: {
      o_street: {
        desc: "Work the length of Halcyon Boulevard for the parts on the list.",
        emotes: [
          "{who} works down the list, counter by counter, and is offered something better at every one of them.",
          "{who} is called by their first name by a man they have never met, who read it off a screen.",
          "{who} finds the fourth item is stocked by nobody on the Boulevard, and buys it in an alley off it.",
        ],
      },
      o_wait: {
        desc: "The last part is behind the clinic counter. Wait for it.",
        emotes: [
          "{who} sits in a warm, clean waiting room while somebody explains what could be done about the ache in their hands.",
          "{who} is handed a brochure, and holds it, and does not read it.",
          "{who} is told there is no obligation, twice, by two different people.",
          "{who} is quoted a figure, and the figure is less than what is in the purse.",
        ],
      },
      o_back: {
        desc: "Take the parts back to the Quartermaster.",
        emotes: [
          "{who} puts the parts and what is left of the purse on the counter, in that order.",
          "{who} notices her counting the purse second.",
        ],
      },
    },
  },

  // ═══ 10 · NOTHING KEPT BACK ══════════════════════════════════════════════
  // The rite, and a door rather than a finish. Pike closes by describing
  // tomorrow, which is nothing, and then thirty years of more of it.
  quest_lw_rite: {
    description:
      "Pike puts his mug down and does not pick it up again.\n\n" +
      "There is one job the Watch does that is not watching, and it comes round about once every four years. Pike has been at the blast door for eleven of them.\n\n" +
      "The Quartermaster has a charge on the counter and will not meet your eye while you pick it up.\n\n" +
      "The vats are the promise. Not the Spire, not the man at the top, not the money. The vats. It is the room where they keep the thing they actually sell, and every person who has ever said yes to them said yes to that room.\n\n" +
      "Bring the colonnade down. Ives will be at the gate on the way out and she will have something to say. Walk past her.\n\n" +
      "Then get home. That last part is not decoration. Three people have done this and one came back.\n\n" +
      "\"Coming back is the whole of it,\" Pike says. \"After that you are on the roster, and the roster is a great deal of standing about in the cold for the rest of your life.\"",
    objectives: {
      o_charge: {
        desc: "Take the charge off the Quartermaster's counter.",
        emotes: [
          "{who} picks up the charge. The Quartermaster finds something else to be doing.",
          "{who} waits a moment in case she says anything, and she does not, and that is her saying it.",
        ],
      },
      o_inside: {
        desc: "Get inside the Vats Hall.",
        emotes: [
          "{who} walks the concourse at the pace of somebody who is expected, which is the only pace that works.",
          "{who} goes under the seal at the door and is not stopped, because nobody stops a person who is already inside.",
        ],
      },
      o_blow: {
        desc: "Wire the charge to the vat colonnade and bring it down.",
        emotes: [
          "{who} works along the colonnade with their back to the room, the way somebody works who belongs there.",
          "{who} sets the last of it and does not look into the nearest tank, having decided that on the way in.",
        ],
      },
      o_ives: {
        desc: "Actuary Verity Ives is at the gate. She is always at the gate. Get past her.",
        emotes: [
          "{who} finds Verity Ives exactly where she said she would be, standing in the noise with her hands at her sides.",
          "{who} recognises the pale grey coat, and an appointment that was already in somebody's diary.",
          "{who} does not answer the thing she says first, because answering it is how she has always started.",
          "{who} listens to the end of it, because she is going to get to the end of it either way.",
          "{who} walks past her, and she does not turn to watch, and that costs her something.",
        ],
      },
      o_home: {
        desc: "Get back to the Blind.",
        emotes: [
          "{who} comes down the mirror-polished plaza steps at a walk, because running is what they look for.",
          "{who} takes the road east with the sound still going on behind them.",
          "{who} gets to the wash and finds Pike on the stool, awake, as though he had simply not gone to bed.",
        ],
      },
    },
  },

  // ═══ FAVOUR · CLOSING AN EYE (repeatable, not a rung) ════════════════════
  quest_lw_fav_eye: {
    description:
      "A camera on the approach to the wash has come back on, which means somebody in an office signed a form about it.\n\n" +
      "Halloran wants it blind again, and blind in the way a camera goes blind on its own: no smashed housing, no cut cable, nothing anybody has to write up.\n\n" +
      "\"Broken is a job for somebody. Faulty is a job for nobody. Make it faulty.\"",
    objectives: {
      o_reach: {
        desc: "Get up to the camera on the approach.",
        emotes: [
          "{who} goes up the back of the housing, where the bracket gives a foot to stand on.",
          "{who} keeps out of its arc on the way up, which takes longer and is the point.",
        ],
      },
      o_close: {
        desc: "Put the camera out in a way that reads as a fault.",
        emotes: [
          "{who} works at the feed until the picture goes the way a picture goes when the weather has got into it.",
          "{who} leaves the housing shut and the screws the way they were found.",
        ],
      },
    },
  },
};

// ─── apply ───────────────────────────────────────────────────────────────────
// Structural skeleton: everything EXCEPT the prose being replaced. If this
// changes, the script has touched something it should not, and refuses to write.
const skeleton = (q) => JSON.stringify({
  ...q,
  description: null,
  objectives: (q.objectives || []).map((o) => ({ ...o, desc: null, emotes: null })),
});

// The one sanctioned objective-type change, applied BEFORE the skeleton is taken
// so the structural diff does not trip on it.
const TYPE_CHANGES = [
  { quest: 'quest_lw_rite', objective: 'o_ives', from: 'assassinate', to: 'talk' },
];

let files = 0, descs = 0, objs = 0, emotes = 0, retypes = 0;
const problems = [];

for (const [id, patch] of Object.entries(Q)) {
  const file = path.join(QUESTS, `${id}.json`);
  if (!fs.existsSync(file)) { problems.push(`${id}: no such quest file`); continue; }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  for (const t of TYPE_CHANGES.filter((t) => t.quest === id)) {
    const o = (data.objectives || []).find((o) => o.id === t.objective);
    if (!o) { problems.push(`${id}: no objective ${t.objective} to retype`); continue; }
    if (o.type !== t.from && o.type !== t.to) { problems.push(`${id}/${t.objective}: expected ${t.from}, found ${o.type}`); continue; }
    if (o.type === t.from) { o.type = t.to; retypes++; }
  }

  const before = skeleton(data);

  if (patch.description !== undefined) {
    if (DASH.test(patch.description)) problems.push(`${id}: em dash in Watch prose`);
    data.description = patch.description; descs++;
  }
  for (const [oid, op] of Object.entries(patch.objectives || {})) {
    const o = (data.objectives || []).find((o) => o.id === oid);
    if (!o) { problems.push(`${id}: no objective "${oid}"`); continue; }
    if (op.desc !== undefined) {
      if (DASH.test(op.desc)) problems.push(`${id}/${oid}: em dash in Watch prose`);
      o.desc = op.desc; objs++;
    }
    if (op.emotes !== undefined) {
      for (const e of op.emotes) {
        if (DASH.test(e)) problems.push(`${id}/${oid}: em dash in emote`);
        if (!e.includes('{who}')) problems.push(`${id}/${oid}: emote without {who}`);
      }
      o.emotes = op.emotes; emotes += op.emotes.length;
    }
  }

  if (skeleton(data) !== before) { problems.push(`${id}: STRUCTURE CHANGED, refusing`); continue; }
  if (!CHECK) fs.writeFileSync(file, canonicalJson(data), 'utf8');
  files++;
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Long Watch: ${files} quest(s), ${descs} description(s), ${objs} objective line(s), ${emotes} emote(s), ${retypes} objective retype(s).`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
