/**
 * Ascendant quest prose. Same contract as rewrite-order-prose-lw.mjs: text
 * fields only, structure asserted unchanged.
 *
 * The Ascendants do get the em dash, densely. Their register is actuarial:
 * coverage, tolerance, lapse, current, collateral, account, retention. They
 * make offers rather than threats, warmly, and the warmth works.
 *
 * ⚠ Two quests are narrated from the Watch side and get no dash in their
 * narration whatever their filename says. `quest_asc_1` is Long Watch slot 7,
 * given by Cyrelle; `quest_asc_cross` opens in a Watch basement. In asc_1 the
 * prose is dash-free until Ives is on the page, so the first dash in the quest
 * is hers. `WATCH_VOICED` enforces this, allowing the dash only in the
 * objective where she speaks.
 *
 * Callbacks from the Watch ladder:
 *   · the Precinct 9 core sat against your ribs like a coin in lw_2. You put it
 *     back in asc_loyalty and the prose remembers the pocket.
 *   · you held an unread brochure in the clinic waiting room in lw_loyalty.
 *     asc_turn is you going back and lying down.
 *   · lw_fav_quiet leaves them breathing so nobody comes looking.
 *     asc_fav_lapse leaves them breathing because Halcyon does not kill clients.
 *
 *   node scripts/content/rewrite-order-prose-asc.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const DIR = path.join(process.cwd(), 'content', 'quests');
const CHECK = process.argv.includes('--check');

// Quests whose narration belongs to the Watch. Value is the objective id, if
// any, where an Ascendant speaks and the dash is therefore allowed to land.
const WATCH_VOICED = { quest_asc_1: 'o3', quest_asc_cross: null };

const PROSE = {

  // ── LW slot 7 · the crossover, told from the Watch side. ───────────────────
  // Dash-free until Ives. She brings the punctuation with her.
  quest_asc_1: {
    description:
      'Cyrelle has noticed it too, which is her way of saying she noticed it first and has been sitting on it.\n\nHalcyon Assurance settles its largest claims by routing them west, past the grasslands, to somewhere that appears on no map the Watch keeps. Not a depot. Not a bank. Somewhere the money goes and does not come out.\n\nSit the claims hall until you can lift the routing slate off the counter. Follow the trail west. Find out what is out there.\n\nWithout getting made. She says that part twice, and she is not a woman who repeats herself for effect.',
    objectives: {
      o0: {
        desc: 'Sit the claims hall in Halcyon Towers until the routing clerk goes on his break.',
        emotes: [
          '{who} lingers by the claims-hall queue, counting how many payouts route somewhere nobody will name.',
          '{who} reads the same page of a leaflet about accidental dismemberment for the ninth time.',
          '{who} watches a man in the queue be told his coverage has lapsed, and watches how gently he is told it.',
        ],
      },
      o1: {
        desc: 'Lift the routing slate off the counter.',
        emotes: [
          '{who} takes the slate off the counter in the half second the clerk spends putting his coat on.',
          '{who} walks it out through a door that opens for them, which is somehow the worst part.',
        ],
      },
      o2: {
        desc: 'Follow the trail west (follow the green GPS line).',
        emotes: [
          '{who} follows the graded track west until the grass gives way to mirror-polished plaza, and a chrome wall of a place turns its scanners on {who}.',
          '{who} realises the road has been maintained the whole way, and that somebody pays for that.',
        ],
      },
      o3: {
        desc: 'Somebody at the gate is waiting for you. Hear her out.',
        emotes: [
          '{who} finds a woman in a pale grey coat already standing off the kerb, as though the appointment was in her diary.',
          '"You are not in trouble," she says, before anything else. "You are not in trouble, you are not being detained, and I am not going to ask you who sent you — I already know, and knowing it is not worth anything to me."',
        ],
      },
      o4: {
        desc: 'Take it back to Cyrelle in the Operations Room. Whatever you decided out there.',
        emotes: [
          '{who} walks the long way back east, and does not hurry, and has plenty to think about.',
          '{who} arrives with an answer ready and finds that Cyrelle does not ask the question.',
        ],
      },
    },
  },

  // ── Slot 1 · benign. The scan. You stop being discussed and start being covered. ─
  quest_asc_2: {
    description:
      'The chrome fortress will not let baseline meat past the Gate — and Maresh, who is standing outside it in a good coat with nowhere else to be, would like you to understand that this is not a judgement. It is a condition. Conditions are the sort of thing that get solved.\n\nSubmit to the Ascension Gate scan. Take the consultation pass. It commits you to nothing, he says, and he is telling the truth, which is what makes it work.\n\nWhatever the Watch wanted you to find out here, you are going to find it on the inside.',
    objectives: {
      o0: {
        desc: 'Submit to the Ascension Gate scan',
        emotes: [
          '{who} steps under the scanline and lets the Gate read {who} down to the marrow.',
          '{who} is thanked, by name, by a building that did not have their name ninety seconds ago.',
        ],
      },
    },
  },

  // ── Slot 3 · the tour, and the reveal that the insurer and the order are one. ─
  quest_asc_3: {
    description:
      'Inside at last, and nobody searched you.\n\nCurator Vess wants to show you the Spire the way the Ascendants show it to the promising — which is to say slowly, in the correct order, with the argument built into the floor plan. The ladder in the Gallery. A resurrection in the Vats. Whatever it is that waits at the top and has been waiting the whole time you have been climbing toward it.\n\nWalk it. By the end you will know what Halcyon Assurance has actually been selling, and you will notice that nobody ever lied to you about it.',
    objectives: {
      o0: {
        desc: 'Walk the Gallery of Rungs',
        emotes: [
          '{who} walks the lit vitrines from crude jack to cortical backup, and feels the exhibit doing its quiet work.',
          '{who} notices the vitrines get warmer in colour as they go, and that this is not an accident.',
        ],
      },
      o1: {
        desc: 'Witness a policy payout in the Vats',
        emotes: [
          '{who} watches a tank drain and a backed-up client sit up, blinking, alive on a paid account.',
          '{who} watches somebody hand the new body a towel and a printed statement of benefits.',
        ],
      },
      o2: {
        desc: 'Ascend to the Executive Sanctum',
        emotes: [
          '{who} rides to the crown of the Spire, where the seal waits, the same calm eye that watches every Halcyon claim.',
          '{who} understands, about four floors before the top, that the insurer and the order were never two things.',
        ],
      },
    },
  },

  // ── ASC slot 7 · the crossover mirror. Watch basement, Watch voice. ────────
  quest_asc_cross: {
    description:
      'Somebody is putting the Watch\'s orders on paper. Paper comes off a press, a press is heavy, and a heavy thing does not move.\n\nVess would like the address. Not the press. Not the printer. The address. He is very clear that nobody is being asked to break anything, and only slightly less clear that this is because breaking things is a different department with its own budget.\n\nYou know the way in. That is the entire reason you were asked, and both of you have been polite enough not to say so out loud.',
    objectives: {
      o_in: {
        desc: 'Get down into the spine. You still know how.',
        emotes: [
          '{who} goes down the way they were shown, on a night when they were somebody else.',
          '{who} finds the grating still lifts the way it always lifted, and wishes it did not.',
        ],
      },
      o_press: {
        desc: 'Find the press.',
        emotes: [
          '{who} finds the room by the smell of the ink before the light reaches it.',
          '{who} reads a set line, upside down and backwards, and can still make out most of it.',
          '{who} recognises the wording, because they carried a copy of it once.',
        ],
      },
      o_cyrelle: {
        desc: 'Somebody is sitting in the dark by the press, and has been for some time.',
        emotes: [
          '{who} finds Cyrelle sitting on a crate with the light off, and she does not get up.',
          '{who} works out from the state of the ashtray that she has been waiting several nights, on a guess.',
          '"Sit down," she says. "You came a long way and I am not going to make you do it standing."',
        ],
      },
      o_out: {
        desc: 'Take the address back up to Vess. Or do not.',
        emotes: [
          '{who} comes up the concourse with an address in their head and a walk that has changed slightly.',
        ],
      },
    },
  },

  // ── Repeatable favour. Pricing a district by walking it. ──────────────────
  quest_asc_fav_actuarial: {
    description:
      'Curator Vess hands you a slate and a route, and explains — pleasantly, at slightly more length than the task deserves — that Halcyon prices a district by walking it, because a satellite cannot smell a stairwell.\n\nWalk the line. Stand where the slate tells you to stand. Bring back numbers that nobody will ever read back to you, and that will nevertheless decide what a street full of people pays to stay alive next year.',
    objectives: {
      o0: {
        desc: 'Take the first reading on Halcyon Boulevard.',
        emotes: [
          '{who} holds the slate up, turns slowly on the spot, and waits for it to stop thinking.',
          '{who} is watched by a shopkeeper who has learned what that posture means for the rent.',
        ],
      },
      o1: {
        desc: 'Take the second reading on Meltwater Row.',
        emotes: [
          '{who} logs a number, and the slate declines to say whether it is a good one.',
          '{who} moves on before anybody can ask them what it said.',
        ],
      },
    },
  },

  // ── Slot 6 · a test that does not look like one. Be unmemorable. ──────────
  quest_asc_fav_adjuster: {
    description:
      'There is a claim Halcyon would rather not contest in public, and a terminal on the Hall of Records approach holding the paperwork that would make contesting it necessary.\n\nVess does not ask you to destroy anything — she is quite firm about that, and she is firm about it early, which is how you know it is the part that matters. She asks you to go and look. And to be the sort of person nobody remembers having looked.\n\n"Nobody will remember me," she says, of herself, apparently by way of encouragement.',
    objectives: {
      o_in: {
        desc: 'Get onto the records approach and wait for the floor to go quiet.',
        emotes: [
          '{who} finds a doorway with a good angle on the corridor and becomes furniture.',
          '{who} lets a clerk walk past close enough to touch, and is not looked at.',
        ],
      },
      o_pull: {
        desc: 'Pull the contested claim off the terminal.',
        emotes: [
          '{who} pulls the claim and leaves the terminal exactly as tidy as they found it.',
          '{who} reads one line of it on the way out, and would rather they had not.',
        ],
      },
    },
  },

  // ── Repeatable favour. The warmth given to a working machine. ─────────────
  quest_asc_fav_coldchain: {
    description:
      'The Weave line makes it and the clinic fits it, and in between there is a walk across a campus that nobody senior has ever had to make.\n\nThe tray is cold. It must stay cold. Vess thanks you for it with the exact warmth she would give a machine that had performed correctly — which is real warmth, delivered accurately, and somehow worse for both of those things.',
    objectives: {
      o_pick: {
        desc: 'Collect the tray from the fabrication line.',
        emotes: [
          '{who} takes the tray in both hands, the way they were shown, once.',
          '{who} feels the cold come up through the handles and quickens their pace without deciding to.',
        ],
      },
      o_drop: {
        desc: 'Deliver it to the theatre.',
        emotes: [
          '{who} sets the tray down and somebody takes it without looking up.',
          '{who} waits half a second for something, and then goes.',
        ],
      },
    },
  },

  // ── Repeatable favour. The mirror of Quiet Hands, unremarked. ─────────────
  quest_asc_fav_lapse: {
    description:
      'A client has stopped paying and is still wearing the collateral.\n\nVess is at pains to point out that this is not a punishment — the account remains open, in good standing, ready to resume the moment it is current. The hardware simply comes home in the meantime. She uses the word "home" without any apparent irony.\n\nShe is also at pains to point out that the client is not to be killed. Halcyon does not kill clients. Halcyon repossesses, and then it writes, and then it waits.',
    objectives: {
      o_down: {
        desc: 'Put the lapsed client down. Down, not out. Halcyon does not kill clients.',
        emotes: [
          '{who} waits for the shoulders to drop, and takes them across the back of the head.',
          '{who} checks for breath, finds it, and gets on with the part they were actually sent for.',
        ],
      },
      o_asset: {
        desc: 'Recover the collateral.',
        emotes: [
          '{who} takes the collateral off a person who is going to wake up without it.',
          '{who} leaves the account paperwork where the client will find it, because those are the standing instructions.',
        ],
      },
    },
  },

  // ── Slot 5 · a test that does not look like one. Bring somebody in. ───────
  quest_asc_fav_lead: {
    description:
      'Somebody in Coldwater has been asking the right questions in the wrong places, which is how everybody arrives here eventually.\n\nMaresh would like them at the Gate alive, unhurried, and still curious — in that order, and he means the order. He mentions, lightly, almost in passing, that the walk out west is not a safe one.\n\nHe does not connect that remark to anything. He does not have to. It is precisely why the offer lands when it lands.',
    objectives: {
      o_meet: {
        desc: 'Find the prospect and introduce yourself.',
        emotes: [
          '{who} finds the prospect mid-question, asking a stranger something a stranger should not be asked.',
          '{who} hears themselves using a phrase of Maresh\'s, and keeps going.',
        ],
      },
      o_walk: {
        desc: 'Walk them west to the plaza, at their pace.',
        emotes: [
          '{who} keeps to the inside of the road and keeps talking, which is most of the job.',
          '{who} answers a question about whether it hurts, and gives the answer they were given.',
        ],
      },
    },
  },

  // ── Slot 4 · fit the part. To WHAT is the test, and nobody says so. ───────
  quest_asc_fav_tolerance: {
    description:
      'Foreman Duc wants a piece run in. Not tested — run in. Out in the world, doing work, on somebody with a pulse and a poor sense of self-preservation, because a bench can tell you what a part does and only a body can tell you what it does to somebody.\n\nHe is explicit that the piece comes back. He is noticeably less explicit about you, and he is not being cruel about it. It simply is not the question he was asked to answer.',
    objectives: {
      o_fit: {
        desc: 'Have the trial piece fitted at the clinic.',
        emotes: [
          '{who} is fitted with a piece that is not theirs and is told to go and live normally for a while.',
        ],
      },
      o_run: {
        desc: 'Bring it back to the line and let Duc read it off you.',
        emotes: [
          '{who} stands still while a man with chrome arms listens to something inside them.',
          '{who} is told the tolerances are good, and is not told what would have happened if they were not.',
        ],
      },
    },
  },

  // ── Slot 2 · benign. A walk with a wallet in it, and Ives says so. ────────
  quest_asc_file: {
    description:
      'Underwriting has a settled file that needs to be in the Registry by end of day, and the Spire does not put settled files on a wire — not because a wire is insecure, but because a settled file is the last piece of paper a person ever generates, and it is handled accordingly.\n\nIves is apologetic about how small the job is, in the way of somebody who is not apologising at all.\n\n"It is a walk with a wallet in it. I would like you to do a fortnight of walks with wallets in them. Everybody does."',
    objectives: {
      o_get: {
        desc: 'Collect the sealed file from the Underwriting counter.',
        emotes: [
          '{who} is handed a wallet across a counter by somebody who says thank you and means it.',
        ],
      },
      o_take: {
        desc: 'Take it up to the Registry, above the vats.',
        emotes: [
          '{who} carries the wallet through three sets of doors that open before they are reached.',
          '{who} passes a wall of enamel nameplates and does not slow down, because slowing down is what the new ones do.',
          '{who} files it where they were told to file it, on a floor where the lights are on a timer.',
        ],
      },
    },
  },

  // ── Slot 9 · cost. The Precinct 9 core goes back in. ─────────────────────
  quest_asc_loyalty: {
    description:
      'The First does not want a body. Bodies are cheap, and He has a building full of them in better condition than yours.\n\nWhat He wants is the eastern approaches back in service — the cameras the Watch have spent years quietly blinding, one at a time, patiently, working again by morning.\n\nYou know where every single one of them is. That is the point. Everybody in the room knows it is the point, and He is far too gracious to say so, and the graciousness is not kindness. It is that saying it would waste a sentence on something already settled.',
    objectives: {
      o_p9: {
        desc: 'Restore the street camera on the Precinct 9 approach.',
        emotes: [
          '{who} seats a fresh core in a housing they emptied themselves, not so long ago.',
          '{who} finds the inside pocket where the old one used to sit, out of habit, and finds it empty.',
          '{who} waits for the amber light, and it comes back on.',
        ],
      },
      o_records: {
        desc: 'Push the Watch\'s blind-spot map back onto the civic net.',
        emotes: [
          '{who} uploads a map that took eleven years to make and ninety seconds to give away.',
          '{who} watches the doorways go from unwatched to watched, in a list, alphabetically.',
        ],
      },
    },
  },

  // ── Slot 10 · the rite. A claimed death, and it is not a metaphor. ───────
  quest_asc_rite: {
    description:
      'Celebrant Orrin will walk you to the Uplink himself, which he does not do often, and which he mentions in a way designed for you to know it is an honour without being told that it is one.\n\nThere is a terminal set into the Curtain where hard light meets cold glass. What happens at it is not a metaphor and nobody here has ever pretended it is: your pattern is held, your account is current, and the only thing still standing between you and the rest of it is the body you came in.\n\nOrrin says none of that. He says it will be over quickly, and that you will not be alone — and both of those are true, which is the Ascendants all over.',
    objectives: {
      o_nave: {
        desc: 'Stand in the Nave with Orrin while the racks are made ready.',
        emotes: [
          '{who} stands among the humming racks and lets a gaunt, delighted man explain what is about to happen to them.',
          '{who} is asked whether they have any questions, and finds that the only one they have is not the sort you ask.',
        ],
      },
      o_uplink: {
        desc: 'Take your place at the Uplink, where the Curtain meets the glass.',
        emotes: [
          '{who} puts both hands flat on the terminal and the hum stops being a sound.',
          '{who} does not look away from the white fire, which is harder than it sounds.',
        ],
      },
      o_ascend: {
        desc: 'Ascend. (`ascend` at the Uplink terminal. It tells you what it costs before it does it.)',
        emotes: [
          '{who} reads what it costs, which is displayed plainly, in full, with nothing held back.',
          '{who} says yes to it, and the Curtain takes them apart with enormous care.',
        ],
      },
    },
  },

  // ── Slot 8 · the fitting. chromed_ever. The door only closes one way. ────
  quest_asc_turn: {
    description:
      'The First Ascended told you your account was already open. It was. It has been since the Gate read you, and reading you was the paperwork.\n\nDr Kesh is downstairs in the consult room and has been expecting you for some time — not impatiently, and not with any doubt about whether you were coming, which is a harder thing to sit with than pressure would have been.\n\nNothing gets signed. There is no moment where you agree to anything. You go down, and you come back up as something with a warranty on it.',
    objectives: {
      o_consult: {
        desc: 'See Dr Kesh in the clinic consult room. The account is in your name already.',
        emotes: [
          '{who} sits down in a warm, clean room they have sat in before, holding a brochure they did not read at the time.',
          '{who} is asked about the ache in their hands, by name, by somebody who already has the answer on a screen.',
        ],
      },
      o_fitted: {
        desc: 'Have your first piece fitted. Any piece — it is the fitting that matters, not the hardware.',
        emotes: [
          '{who} lies back under the light and lets somebody open them up on purpose.',
          '{who} goes under counting, and gets to four.',
        ],
      },
    },
  },
};

// ── apply ───────────────────────────────────────────────────────────────────
const skeleton = (q) => JSON.stringify({
  ...q,
  description: null,
  objectives: (q.objectives || []).map((o) => ({ ...o, desc: null, emotes: null })),
});

const EM = /—/;
const FAKE_DASH = / - | -- |–/;   // never trade one dash for another

let files = 0, descs = 0, objs = 0, emotes = 0;
const problems = [];

for (const [id, prose] of Object.entries(PROSE)) {
  const file = path.join(DIR, `${id}.json`);
  if (!fs.existsSync(file)) { problems.push(`${id}: no such quest file`); continue; }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const before = skeleton(data);
  const watchVoiced = Object.prototype.hasOwnProperty.call(WATCH_VOICED, id);
  const dashAllowedIn = WATCH_VOICED[id];

  const vet = (text, where, allowEm) => {
    if (FAKE_DASH.test(text)) problems.push(`${id}${where}: substitute dash, use the sentence instead`);
    if (EM.test(text) && !allowEm) problems.push(`${id}${where}: em dash in Watch-voiced prose`);
  };

  if (prose.description) {
    vet(prose.description, ' description', !watchVoiced);
    data.description = prose.description;
    descs++;
  }

  for (const [oid, patch] of Object.entries(prose.objectives || {})) {
    const obj = (data.objectives || []).find((o) => o.id === oid);
    if (!obj) { problems.push(`${id}: no objective "${oid}"`); continue; }
    const allowEm = !watchVoiced || oid === dashAllowedIn;
    if (patch.desc) { vet(patch.desc, `/${oid} desc`, allowEm); obj.desc = patch.desc; objs++; }
    if (patch.emotes) {
      for (const e of patch.emotes) {
        vet(e, `/${oid} emote`, allowEm);
        // A quoted line of NPC speech is a voice, not an action, and correctly
        // carries no {who}. Everything else must name the actor.
        if (!e.includes('{who}') && !e.trimStart().startsWith('"')) {
          problems.push(`${id}/${oid}: emote has no {who} token and is not quoted speech`);
        }
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
console.log(`${CHECK ? '[check] ' : ''}Ascendants: ${files} quest(s), ${descs} description(s), ${objs} objective line(s), ${emotes} emote(s).`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
