/**
 * The Ascendants, slots 1-10 — rewritten as the FIRST QUARTER of a forty-slot
 * ladder rather than as a complete story.
 *
 * The Watch pass (arc-rewrite-lw.mjs) works by bluntness. This one works by its
 * exact opposite, and the rule comes straight out of Wells:
 *
 *   THE EUPHEMISM IS THE ATROCITY. The Labour Department has ended homelessness.
 *   "We have abolished destitution. It is engraved upon the Department's
 *   checks." Nobody in that book is lying and nobody is a villain in his own
 *   account. So no Ascendant line here is sinister, evasive or cruel. Every one
 *   of them is warm, correct, and would survive being read aloud in a hearing.
 *   The horror is entirely in what the correct words are describing, and the
 *   prose never once supplies the translation.
 *
 * Three more, same source list:
 *
 * - LET THE CYNIC STATE THE MECHANISM OUT LOUD (Ostrog). At the crossover Ives
 *   explains exactly how the machine works, without shame, and it is more
 *   disarming than concealment would be.
 * - GIVE THE ENEMY A SINCERE ETHIC AND NEVER LET THEM DOUBT IT (London). Nobody
 *   here has a private moment of misgiving. They mean it.
 * - THE IMPORTANT SPEECH SHOULD COME OUT BADLY (Wells, on Graham at the
 *   cameras). At slot 10 the celebrant of the most sacred rite this order has
 *   loses the thread and finishes it flatly. That is the one moment the company
 *   is visibly staffed by people, and it lands hardest where it should be most
 *   machine.
 *
 * NOTHING RESOLVES AT SLOT 10. You are printed, and the first thing that happens
 * to you afterwards is paperwork. Thirty slots of it.
 *
 * VOICE / EM DASHES. The dash is the Ascendant and Architect tell (docs/story.md)
 * and is used freely here. `noDash` lists the fields in these files where
 * somebody who is NOT an Ascendant is speaking — the Watch's narration in
 * `quest_asc_1` and Corin Halbrook before he joins — and the
 * script fails if a dash lands in one of them. ⚠ Halbrook is faction-null on
 * purpose: he picks the cadence up by joining, and the absence is the
 * characterisation.
 *
 *   node scripts/content/arc-rewrite-asc.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const QUESTS = path.join(process.cwd(), 'content', 'quests');
const CHECK = process.argv.includes('--check');
const DASH = /[—–]/;

const Q = {

  // ═══ 1 · THE THRESHOLD ═══════════════════════════════════════════════════
  // You stop being a person they are discussing and start being one they are
  // covering. Nobody says anything untrue.
  quest_asc_2: {
    description:
      "Stand on the plate at the Gate and let the Warden read you.\n\n" +
      "It takes four seconds and there is no needle, no form and no fee. At the end of it you exist — as a file, as a projection, as a set of numbers about how likely you are to be alive in a year, and Halcyon has an opinion about that number for the first time.\n\n" +
      "Nothing is asked of you. That is not a trick; it is the product. Everything the Ascendants do rests on the fact that being known by them is free and being unknown by them is expensive, and they have never once had to explain that to anybody twice.",
    objectives: {
      o0: {
        desc: "Stand on the plate at the Halcyon Gate and let the Warden Unit read you.",
        emotes: [
          "{who} steps onto the plate and the scanline goes over them like weather.",
          "{who} is measured, priced, and filed, in about the time it takes to be looked at.",
          "{who} steps off, and something in a building four streets away now has a view about how long they will live.",
        ],
      },
    },
  },

  // ═══ 2 · PROOF OF LOSS ═══════════════════════════════════════════════════
  // A walk with a wallet in it, and Ives says so. The first evasion about the
  // wider board sits here and is one sentence long.
  quest_asc_file: {
    description:
      "A claim file wants collecting from a broker two districts over and bringing to the underwriting floor. It is a walk with a wallet in it.\n\n" +
      "Verity Ives is candid about that. \"I could give you something dramatic instead — and it would tell you nothing true about us at all. This is what the work is. Most of it is carrying a number from where it was measured to where it is decided.\"\n\n" +
      "You ask whether the broker is one of theirs.\n\n" +
      "\"He sells to four buyers. We are the one that pays on time.\"\n\n" +
      "She does not name the other three. She does not appear to be avoiding it either.",
    objectives: {
      o_get: {
        desc: "Collect the claim file from the broker two districts over.",
        emotes: [
          "{who} gives a name at a counter and is handed a folder by somebody who was expecting them.",
          "{who} notices the folder has been opened, read, and closed by somebody careful.",
          "{who} is thanked for their business, which is a strange thing to be thanked for.",
        ],
      },
      o_take: {
        desc: "Take the file to the underwriting floor.",
        emotes: [
          "{who} carries a folder across a marble lobby and is not stopped once.",
          "{who} puts it on a desk where eleven identical folders are already waiting, and none of them are urgent.",
        ],
      },
    },
  },

  // ═══ 3 · ASSURANCE FOR THE ASSURED ═══════════════════════════════════════
  // The tour. This is where the vats are established, which is what makes the
  // Watch's rite land nine slots later on the other ladder.
  quest_asc_3: {
    description:
      "Vess will show you the building. She is very good at this and she has done it several thousand times.\n\n" +
      "The Gallery first, because it is beautiful. Then the Vats, because that is the promise — the room where a body is kept against the day you need another one, warm, indexed, and paid up. Then the Sanctum, which is small, and quiet, and where the actual signing happens.\n\n" +
      "\"People think we sell chrome,\" she says on the stairs. \"We sell the sentence *and then*. Everything else is delivery.\"",
    objectives: {
      o0: {
        desc: "Walk the Gallery with Vess.",
        emotes: [
          "{who} is walked past the portraits of eleven people who are all still alive.",
          "{who} notices the vitrines get warmer in colour the further in they go.",
          "{who} is told the name of the artist, and the name of the client, and only one of them was paid.",
        ],
      },
      o1: {
        desc: "See the Vats.",
        emotes: [
          "{who} comes out onto the colonnade and finds the room is warm, and quiet, and enormous.",
          "{who} looks into the nearest tank because everybody does, and Vess waits, because everybody does.",
          "{who} is told the tank is a subscription rather than a purchase, in the tone of somebody clearing up a common misunderstanding.",
        ],
      },
      o2: {
        desc: "Finish the tour in the Sanctum.",
        emotes: [
          "{who} is shown into a small room with two chairs and no window.",
          "{who} is told this is where it is signed, and that it takes less time than the tour did.",
        ],
      },
    },
  },

  // ═══ 4 · WITHIN TOLERANCE ════════════════════════════════════════════════
  // Fit the part. TO WHAT is the test, and nobody says so.
  quest_asc_fav_tolerance: {
    description:
      "A calibration set wants fitting to a unit on the underwriting floor, and Kesh would like you to do it rather than one of his technicians.\n\n" +
      "He gives you the tolerance and the torque and the order of operations, and mentions — once, in passing, on his way to something else — that the part is within tolerance and the mount is not.\n\n" +
      "He does not tell you what to do about that. He watches your hands from across the room while pretending to read.",
    objectives: {
      o_fit: {
        desc: "Fit the calibration set to the unit on the underwriting floor.",
        emotes: [
          "{who} lays the set out in order before touching anything, which is either training or temperament.",
          "{who} finds the mount is out by the width of a fingernail, and stops.",
          "{who} does it properly, which takes eleven minutes longer than doing it.",
        ],
      },
      o_run: {
        desc: "Run the unit up and report the result.",
        emotes: [
          "{who} brings it up to load and holds it there longer than the sheet asks for.",
          "{who} reports the mount, and Kesh says \"yes\" in the voice of a man ticking a box he had already drawn.",
        ],
      },
    },
  },

  // ═══ 5 · A WARM LEAD ═════════════════════════════════════════════════════
  // Bring somebody else in. ⚠ Halbrook has no em dashes and must not be given
  // any: he is a Coldwater civilian who has not walked west yet.
  quest_asc_fav_lead: {
    description:
      "Corin Halbrook has been to the Gate twice this month and turned round both times. Ives would like somebody nearer his own life to walk in with him.\n\n" +
      "\"He is not frightened of us,\" she says. \"He is frightened of the walk. That is very common and it is not a character flaw — it is just a distance, and distances are solved by company.\"\n\n" +
      "Meet him on Kessler. Walk him west. Nobody is going to ask him to sign anything today, and Ives is quite clear that if you tell him otherwise she will hear about it.",
    noDash: ['o_meet'],
    objectives: {
      o_meet: {
        desc: "Meet Corin Halbrook on Kessler Street.",
        emotes: [
          "{who} finds a man standing outside a shut shop with a folded paper he has stopped reading.",
          "{who} listens to him say he is only having a look, twice, without being asked.",
          "{who} hears him mention his mother's hands, and then apologise for mentioning it.",
        ],
      },
      o_walk: {
        desc: "Walk Halbrook west to the Gate.",
        emotes: [
          "{who} keeps to his pace, which is slower on the second half of every street.",
          "{who} answers a question about whether it hurts, honestly, and watches him take that badly and keep walking.",
          "{who} gets him to the plate, where he stops, and then steps on it himself.",
        ],
      },
    },
  },

  // ═══ 6 · ADJUSTER ════════════════════════════════════════════════════════
  // The line is the whole quest and it is delivered as reassurance.
  quest_asc_fav_adjuster: {
    description:
      "An adjuster is going to a residence on the ninth floor this afternoon to close an account that has been in arrears for a year, and she would like somebody in the corridor while she does it.\n\n" +
      "Not to come in. Not to be introduced. Not to intervene, she is quite firm about that, and she is firm about it early.\n\n" +
      "\"He will not take it well and it will not last long,\" she says, checking the floor number against a card she does not need to check. \"Nobody will remember me. They remember the corridor.\"",
    objectives: {
      o_in: {
        desc: "Get up to the ninth floor and take the corridor.",
        emotes: [
          "{who} finds a doorway with a good angle on the corridor and stops being a person in a corridor.",
          "{who} hears the first two minutes go quite well, which is the part nobody warns you about.",
        ],
      },
      o_pull: {
        desc: "Pull the account record while the adjuster is inside.",
        emotes: [
          "{who} works the panel with the sound of a conversation changing register on the other side of a wall.",
          "{who} gets the record, and reads the date the account went into arrears, and does the arithmetic without meaning to.",
        ],
      },
    },
  },

  // ═══ 7 · WHERE IT IS PRINTED ═════════════════════════════════════════════
  // The crossover. Ives makes her pitch standing in daylight having done the
  // sums; the man at the press is not making a pitch at all, which is the
  // sharper version of the same scene. Neither threatens and neither wins.
  // ⚠ Cyrelle is Watch. No dashes in her objective.
  quest_asc_cross: {
    description:
      "Somebody is printing the Watch's handbills on a real press, on paper, which is slow and expensive and cannot be switched off from an office. Halcyon would like to know where.\n\n" +
      "Ives is unusually direct about the reason. \"Not to burn it. To have the address. An address is a thing you can decide about later — and later is where the whole business lives.\"\n\n" +
      "The press is under a dye works east of the wash. Get in, confirm it, get out. Nobody is asking you to touch it.",
    // ⚠ NOT Cyrelle. The NPC at the press is `npc_asc_lapsed` — Wessel Ardy,
    // male, faction null, a lapsed Halcyon client with two clean ports in the
    // back of his neck. Cyrelle is a different person: Long Watch, female, at
    // the ops room, and she is the one who gives `quest_asc_1`. The first draft
    // of this rewrite took the name from systems-faction-arcs.md, which had it
    // wrong, and put it in front of the player.
    //
    // He also KEEPS his em dashes, so there is no `noDash` here. He is ex-
    // Ascendant and the cadence stuck; that is the characterisation.
    objectives: {
      o_in: {
        desc: "Get into the dye works east of the wash.",
        emotes: [
          "{who} goes in through the yard, where the smell means nobody stands about.",
          "{who} finds the floor hatch under a stack of pallets that were put there to be moved.",
        ],
      },
      o_press: {
        desc: "Find the press.",
        emotes: [
          "{who} comes down into a low room that is warm for no reason a room should be warm.",
          "{who} finds a press, oiled, loaded, and stopped mid-run, with the ink still wet on the last sheet.",
        ],
      },
      o_cyrelle: {
        desc: "Somebody is sitting in the dark next to it. He does not get up.",
        emotes: [
          "{who} realises a man has been sitting six feet away for the whole of the last minute.",
          "{who} takes in a good coat gone shapeless, and two clean ports in the back of a neck.",
          "{who} is told he wants nothing, is not Watch, and is not recruiting — and finds all three of those turn out to be true.",
          "{who} gets one plain sentence about the job after this one, from the only person who has ever bothered to say it beforehand.",
          "{who} is not threatened, not argued with, and not stopped.",
        ],
      },
      o_out: {
        desc: "Get out and take the address back.",
        emotes: [
          "{who} climbs back into the yard with an address they could give to four different people.",
          "{who} spends the walk west deciding, and arrives having decided.",
        ],
      },
    },
  },

  // ═══ 8 · THE ACCOUNT ═════════════════════════════════════════════════════
  // The fitting. `chromed_ever` burns the flesh path here, and the scene is
  // about a consultation, a chair, and a reasonable man being reasonable.
  quest_asc_turn: {
    description:
      "Kesh will see you now.\n\n" +
      "It is a consultation, and it is genuinely one — he will talk you out of two of the three things you might have wanted, on the grounds that they are not worth what they cost you. He is a good surgeon and he is not selling.\n\n" +
      "What he does not say, because it is on the form and he assumes you have read the form, is that this is the last appointment at which you are a person who has never been opened. The Exodus can undo it, at a price, and nobody else in this city can — and Kesh does not do that work, and will not say who does.\n\n" +
      "\"Sit down,\" he says. \"You will be walking in an hour.\"",
    objectives: {
      o_consult: {
        desc: "Sit the consultation with Kesh.",
        emotes: [
          "{who} is talked out of the expensive one, at length, by the man who would have been paid for it.",
          "{who} is asked what they do with their hands all day, and answers, and watches him write it down.",
          "{who} signs the form on the second page and is not asked to read the first.",
        ],
      },
      o_fitted: {
        desc: "Take the chair and be fitted.",
        emotes: [
          "{who} takes the chair, and the last thing they hear is somebody counting backwards without much interest.",
          "{who} comes round to find the room tidied and a cup of water already poured and gone cold.",
          "{who} finds it does not hurt, and that this is somehow the part that is difficult.",
        ],
      },
    },
  },

  // ═══ 9 · RESTORING SERVICE ═══════════════════════════════════════════════
  // The euphemism at its purest. Every camera the Watch blinded goes back on,
  // and the word for that is service.
  quest_asc_loyalty: {
    description:
      "Nine cameras on the approach to the wash have been faulty for a long time. Some of them have been faulty for years.\n\n" +
      "The work order calls it restoring service. It is restoring service — the cabling is sound, the housings are intact, the faults are all in software, and every one of them will come back on in an afternoon with the right credentials and somebody willing to walk the approach.\n\n" +
      "Vess mentions that the district has had four assaults on that stretch this year and no pictures of any of them. She is not making an argument. She is telling you what the cameras are for, which is what they are for.",
    objectives: {
      o_p9: {
        desc: "Get to the distribution point on the approach.",
        emotes: [
          "{who} walks the approach in daylight, which nobody from either side does.",
          "{who} finds the cabinet, and finds it unlocked, because nobody has needed to lock it for years.",
        ],
      },
      o_records: {
        desc: "Restore the camera records.",
        emotes: [
          "{who} clears nine faults in about forty minutes and none of them put up a fight.",
          "{who} watches the last picture come up, and the picture is of the road home.",
          "{who} closes the cabinet and walks back past nine cameras that are working.",
        ],
      },
    },
  },

  // ═══ 10 · THE RITE OF ASCENSION ══════════════════════════════════════════
  // The celebrant fumbles it. Wells will not let Graham find the words at the
  // cameras, and the fumbling is the sincerity; the same trick works even
  // harder on a corporation, because a corporation is not supposed to have a
  // bad day. Then you wake up and are handed a form.
  quest_asc_rite: {
    description:
      "Your backup is taken in the morning and is very boring. The Rite is in the evening and is not.\n\n" +
      "You go up to the Nave and somebody reads the words, and about two thirds of the way through he loses his place — properly loses it, shuffles the card, apologises, and finishes the last part from memory in the voice of a man saying a thing he means rather than a thing he has learned.\n\n" +
      "Then you go to the Uplink and you die there, on purpose, on schedule, with the claim already filed. Somewhere below you a tank that has been quietly paid up since the day of the tour opens on a body with your face on it.\n\n" +
      "They will not do it while the police want you, and Vess is apologetic but immovable about that. A claimed death is an administrative act — and the law does not recognise administration.",
    objectives: {
      o_nave: {
        desc: "Go up to the Nave for the reading.",
        emotes: [
          "{who} sits in the second row because the first row is for people with families here.",
          "{who} listens to a man lose his place in the most important thing he says all year.",
          "{who} hears the last part done from memory, and finds it is better that way, and cannot say why.",
        ],
      },
      o_uplink: {
        desc: "Go to the Uplink.",
        emotes: [
          "{who} walks up a corridor that is carpeted the whole way, which somebody thought about.",
          "{who} is asked to confirm their name, and confirms it, and that is the entire ceremony.",
        ],
      },
      o_ascend: {
        desc: "Die at the Uplink, and be printed.",
        emotes: [
          "{who} finds it is quick, and that being ready for it does not make it quick enough.",
          "{who} opens their eyes in a warm room with the drain still running.",
          "{who} is handed a towel, and then a form, and the form is the part that means it worked.",
        ],
      },
    },
  },

  // ═══ THE WATCH-SIDE CROSSOVER (Long Watch slot 7) ════════════════════════
  // ⚠ This file is a WATCH quest. The Watch sent you; the narration is theirs
  // and carries no dash. Ives speaks in `o3` and the dash lands there and
  // nowhere else in the file.
  quest_asc_1: {
    description:
      "Halcyon is paying somebody in Civic and the Watch would like the paper that proves it.\n\n" +
      "The Quartermaster has a route in, a name on a door, and a warning she delivers flatly and does not repeat: the woman at the gate reads people for a living, she will already have been told you are coming, and she will be pleasant.\n\n" +
      "\"She is not going to stop you,\" she says. \"She is going to make you an offer. That is not the same as a trap and I want you to know the difference before you are standing in it.\"",
    noDash: ['description', 'o0', 'o1', 'o2', 'o4'],
    objectives: {
      o0: {
        desc: "Get into the Halcyon underwriting annexe.",
        emotes: [
          "{who} goes in behind a delivery, which works because nobody watches a thing going in.",
          "{who} counts three cameras on the way to the stair and is seen by all three.",
        ],
      },
      o1: {
        desc: "Get the payment record.",
        emotes: [
          "{who} finds the record filed under a heading so dull it is almost a hiding place.",
          "{who} reads a name they know from a counter in Civic, and a figure, and the figure is small.",
        ],
      },
      o2: {
        desc: "Get out to the gate.",
        emotes: [
          "{who} takes the annexe stair down at the pace of somebody finishing a shift.",
          "{who} comes out into the plaza and finds a woman in a pale grey coat already looking at the door they are coming out of.",
        ],
      },
      o3: {
        desc: "Actuary Verity Ives would like a word.",
        emotes: [
          "{who} is greeted by name by somebody who has never met them.",
          "{who} is told, accurately and without malice, what the Watch pays and what it costs to stay in it.",
          "{who} listens to her explain the whole machine out loud — the vats, the premiums, who actually gets covered — as though describing weather.",
          "{who} is offered a number, and the number is not insulting, which is worse.",
          "{who} is told to take a week, and that the offer does not expire, because offers that expire are for people you do not want.",
        ],
      },
      o4: {
        desc: "Take the record back to the Blind.",
        emotes: [
          "{who} walks east with the paper in one pocket and a figure in their head that will not settle.",
          "{who} puts the record on the counter and does not mention the plaza, or does, and either way the Quartermaster already knows.",
        ],
      },
    },
  },
};

// ─── apply ───────────────────────────────────────────────────────────────────
const skeleton = (q) => JSON.stringify({
  ...q,
  description: null,
  objectives: (q.objectives || []).map((o) => ({ ...o, desc: null, emotes: null })),
});

let files = 0, descs = 0, objs = 0, emotes = 0;
const problems = [];

for (const [id, patch] of Object.entries(Q)) {
  const file = path.join(QUESTS, `${id}.json`);
  if (!fs.existsSync(file)) { problems.push(`${id}: no such quest file`); continue; }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const noDash = new Set(patch.noDash || []);
  const before = skeleton(data);

  if (patch.description !== undefined) {
    if (noDash.has('description') && DASH.test(patch.description)) {
      problems.push(`${id}: em dash in a non-Ascendant description`);
    }
    data.description = patch.description; descs++;
  }

  for (const [oid, op] of Object.entries(patch.objectives || {})) {
    const o = (data.objectives || []).find((o) => o.id === oid);
    if (!o) { problems.push(`${id}: no objective "${oid}"`); continue; }
    const mustNotDash = noDash.has(oid);
    if (op.desc !== undefined) {
      if (mustNotDash && DASH.test(op.desc)) problems.push(`${id}/${oid}: em dash in a non-Ascendant voice`);
      o.desc = op.desc; objs++;
    }
    if (op.emotes !== undefined) {
      for (const e of op.emotes) {
        if (mustNotDash && DASH.test(e)) problems.push(`${id}/${oid}: em dash in a non-Ascendant emote`);
        if (!e.includes('{who}')) problems.push(`${id}/${oid}: emote without {who}`);
      }
      o.emotes = op.emotes; emotes += op.emotes.length;
    }
  }

  if (skeleton(data) !== before) { problems.push(`${id}: STRUCTURE CHANGED, refusing`); continue; }
  if (!CHECK) fs.writeFileSync(file, canonicalJson(data), 'utf8');
  files++;
}

// The Ascendant ladder must actually SOUND like itself: at least one dash across
// the files whose narration is theirs, or the voice tell has quietly gone.
const ascVoiced = Object.entries(Q).filter(([, p]) => !(p.noDash || []).includes('description'));
const dashed = ascVoiced.filter(([, p]) => DASH.test(p.description || '')).length;
if (dashed < 4) problems.push(`only ${dashed} Ascendant description(s) carry the dash tell — expected at least 4`);

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Ascendants: ${files} quest(s), ${descs} description(s), ${objs} objective line(s), ${emotes} emote(s).`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
