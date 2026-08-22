/**
 * Phase 3 — the three instructors, and the dialogue that hangs the pack on the
 * Long Watch cast.
 *
 * ⚠ THIS IS THE FIX FOR AN UNREACHABLE SYSTEM, not a nicety. Before this file,
 * `grep -rl mastery_instructor content/` returned NOTHING: the mastery plugin
 * shipped a `train` verb, a rep gate, a purity gate, a per-instructor ceiling
 * and a teaching step, and there was no teacher anywhere in the world for any of
 * it to apply to. `train` could only ever answer "nobody here teaches that".
 *
 * THE LADDER IS THE REWARD, which is the whole Long Watch answer to the
 * Ascendants' shelf of chrome: you do not climb their standing to buy a better
 * body, you climb it to be taught by somebody who knows more. `rep_required` and
 * `max_rank` already existed on the instructor config and already did exactly
 * this — nothing new is wired.
 *
 *   Pike           Known (200)        → 35   body, breath
 *   Quartermaster  Trusted (500)      → 65   senses, will
 *   Teague         Inner Circle (900) → 100  movement, pain, mind, combat
 *
 * Teague is deliberately the furthest away (the Under, not the base) and the
 * only one who can take you to the ceiling. Reaching her is what the rite's
 * reputation reward is FOR — no second gate was added for it, because the rep
 * she already checks is the gate.
 *
 * ⚠ The refusals these produce must never name a tier, a number or a flag — the
 * mastery plugin already owns that rule (`doTrain`), and none of the prose below
 * may quietly undo it by explaining the ladder in dialogue.
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const NPCS = path.resolve(process.cwd(), 'content', 'npcs');
const LW = 'ideology_long_watch';

const load = (id) => JSON.parse(fs.readFileSync(path.join(NPCS, `${id}.json`), 'utf8'));
const save = (npc) => {
  fs.writeFileSync(path.join(NPCS, `${npc.id}.json`), canonicalJson(npc), 'utf8');
  console.log(`  updated content/npcs/${npc.id}.json`);
};

const MARK = 'lw_vigil';
const mine = (o) => ({ ...o, _src: MARK });
const stripMine = (opts) => (opts || []).filter((o) => o._src !== MARK);

const offerable = (questId, repeatable) => (repeatable
  ? { flag: questId, op: 'neq', value: 'active', scope: 'player' }
  : { flag: questId, op: 'unset', scope: 'player' });

function questNodes(key, { offer, accept, report, questId, acceptLabel, declineLabel, doneLabel, rewardNote }) {
  return {
    [`${key}_offer`]: {
      text: offer,
      options: [
        { next: `${key}_accept`, label: acceptLabel },
        { next: 'bye', label: declineLabel },
      ],
    },
    [`${key}_accept`]: {
      text: accept,
      actions: [{ action: 'START_QUEST', quest_id: questId }],
      options: [{ next: 'bye', label: doneLabel }],
    },
    [`${key}_report`]: {
      text: report,
      actions: [{ action: 'TURN_IN', quest_id: questId }],
      options: [{ next: 'bye', label: rewardNote }],
    },
  };
}

function rootPair(key, questId, { repeatable = false, offerLabel, reportLabel, extra = [] }) {
  const rows = [];
  if (offerLabel) {
    rows.push(mine({ next: `${key}_offer`, label: offerLabel, conditions: [...extra, offerable(questId, repeatable)] }));
  }
  rows.push(mine({
    next: `${key}_report`, label: reportLabel,
    conditions: [{ flag: questId, op: 'eq', value: 'completed', scope: 'player' }],
  }));
  return rows;
}

const MEMBER = { flag: 'lw_member', op: 'set', scope: 'player' };

console.log('— instructors —');

// ── Pike, at the Threshold: the first teacher ───────────────────────────────
{
  const npc = load('npc_lw_pike');
  npc.flags = {
    ...npc.flags,
    mastery_instructor: {
      disciplines: ['body', 'breath'],
      rep_required: 200,   // Known
      max_rank: 35,
    },
  };

  Object.assign(npc.dialogue_tree, {
    teach: {
      text: '"Teach." Pike considers the mug rather than you. "I can show you two things and they are the same thing twice. How to stand for a long time without it costing you anything, and how to breathe while you do it."\n\nHe shifts on the stool, which is the most he has moved since you came in.\n\n"That is not modesty. Everybody who has ever lasted down here started with those two, and most of what comes after is people dressing them up. `train body`, or `train breath`. Bring the rest of it to somebody who has seen more than a door."',
      options: [{ next: 'bye', label: "I'll come and stand, then." }],
    },
    ...questNodes('sit', {
      questId: 'quest_lw_fav_sit',
      offer: '"Somebody has to sit the Blind while somebody else sleeps." He says it the way you would mention weather. "Mirror looks down the wash. Shortwave talks to itself. The whole of the job is that you are there and you are awake."\n\n"I have sat it about ten thousand times. I will not thank you for it, and neither will anyone else, and that is not rudeness. It is just that somebody sitting there is the ordinary state of things."',
      accept: '"Do not open the door. If something comes down the wash you watch it come, and you write the time, and you do not open the door."',
      report: 'He takes the stool back without ceremony. "Anything?" You say no. "Good," says Pike, and means it.',
      acceptLabel: "I'll take a turn.",
      declineLabel: 'Another time.',
      doneLabel: 'Not the door.',
      rewardNote: '(hand back the stool)',
    }),

    // The rite. Pike offers it because Pike is the man who has sat it ten
    // thousand times, and the order is named after what he does for a living.
    //
    // Gated on: membership, the loyalty test passed, Inner Circle standing, AND
    // the `mastery` shape (a body carrying nothing, and something actually
    // learned). That last one is the new condition shape, and it is what stops
    // this being a reputation-only door on the one order whose whole argument is
    // that standing is not a substitute for having done the work.
    rite_offer: {
      text: '"Right." Pike puts the mug down, which you have not seen before.\n\n"There is no ceremony and I am not going to invent one for you. I get off the stool, and I go, and I do not come back until morning. You sit the Blind on your own until somebody relieves you."\n\n"Nothing will happen. Nothing is supposed to happen. That is not a warning, it is the entire content of the thing — the Watch are called the Watch because somebody has been sitting in a cold room the whole time, and tonight the somebody is you, and there is nobody behind you to check."\n\nHe looks at you properly for the first time in all of this.\n\n"Do not open the door. Do not go and look. Do not do anything at all. If you get up, you start again, and I will not say a word about it."',
      options: [
        { next: 'rite_accept', label: 'Go and get some sleep, Pike.' },
        { next: 'bye', label: 'Not tonight.' },
      ],
    },
    rite_accept: {
      text: 'He stands, stretches something that clicks, and hands you the mug, which is still warm.\n\n"Morning, then."',
      actions: [{ action: 'START_QUEST', quest_id: 'quest_lw_rite' }],
      options: [{ next: 'bye', label: '(take the stool)' }],
    },
    rite_report: {
      text: 'Pike comes back at whatever hour it is with his coat still buttoned wrong and looks at you sitting exactly where he left you.\n\nHe does not say congratulations. He does not say well done. He takes the mug out of your hands, looks down the wash out of habit, and says:\n\n"Anything?"\n\nAnd you say no. And that is the whole of it, and you understand, sitting there with your legs gone dead under you, that it was always going to be the whole of it.',
      actions: [{ action: 'TURN_IN', quest_id: 'quest_lw_rite' }],
      options: [{ next: 'bye', label: 'Nothing. All night.' }],
    },
    kept: {
      text: 'Pike nods at the stool as you pass, which he does now, and did not before.',
      options: [{ next: 'bye', label: '(nod back)' }],
    },
  });

  npc.dialogue_tree.root.options = [
    ...stripMine(npc.dialogue_tree.root.options).filter((o) => o.next !== 'bye'),
    mine({ next: 'teach', label: 'Can you teach me anything?', conditions: [MEMBER] }),
    ...rootPair('sit', 'quest_lw_fav_sit', {
      repeatable: true,
      offerLabel: 'Anything need sitting?',
      reportLabel: 'I sat the Blind.',
      extra: [MEMBER],
    }),
    mine({
      next: 'rite_offer', label: 'I want to stand the watch.',
      conditions: [
        { flag: 'lw_loyal', op: 'set', scope: 'player' },
        { flag: 'quest_lw_rite', op: 'unset', scope: 'player' },
        { flag: 'watch_kept', op: 'unset', scope: 'player' },
        { ideology_rep: LW, tier: 'inner_circle' },
        // The body, and the work. Not a substitute for either.
        { mastery: 'any', min: 25, pure: true },
      ],
    }),
    mine({
      next: 'rite_report', label: 'Nothing happened. All night.',
      conditions: [{ flag: 'quest_lw_rite', op: 'eq', value: 'completed', scope: 'player' }],
    }),
    mine({ next: 'kept', label: '(take the stool a moment)', conditions: [{ flag: 'watch_kept', op: 'set', scope: 'player' }] }),
    { next: 'bye', label: 'Nothing.' },
  ];

  save(npc);
}

// ── The Quartermaster: the second teacher, and the loyalty test ─────────────
{
  const npc = load('npc_lw_quartermaster');
  npc.flags = {
    ...npc.flags,
    mastery_instructor: {
      disciplines: ['senses', 'will'],
      rep_required: 500,   // Trusted
      max_rank: 65,
    },
  };

  Object.assign(npc.dialogue_tree, {
    teach: {
      text: '"I fit gear to people," she says, without looking up from the ledger. "Which means most of my job is looking at somebody for four seconds and knowing what they will do under load. You can learn that. It is not a gift, it is a habit with a very long run-up."\n\nShe closes the ledger.\n\n"Senses, and will. Noticing, and not giving in. `train senses` or `train will`, and bring me your hands clean."',
      options: [{ next: 'bye', label: 'Understood.' }],
    },
    ...questNodes('carry', {
      questId: 'quest_lw_fav_carry',
      offer: 'She turns a page. "I keep two ledgers. One is everything the Watch owns. The other is everything it has lost, and it is shorter, and I take it personally."\n\n"There is a cache under the Fisherman\'s Green that has been in the second book for a month. It is not dangerous and it is not clever. I would simply like it back where it belongs."',
      accept: '"Both books balance by the end of the week or I will be unpleasant about it, and I am very good at that."',
      report: 'She takes it, checks it against the page without any visible pleasure, and strikes a line through the entry. Then she looks at the line for a second longer than she needs to.',
      acceptLabel: "I'll fetch it.",
      declineLabel: 'Not today.',
      doneLabel: 'By the week.',
      rewardNote: '(let her have the moment)',
    }),
    ...questNodes('loyalty', {
      questId: 'quest_lw_loyalty',
      offer: 'The Quartermaster puts a purse on the counter. It is heavier than the errand needs to be and both of you can see that.\n\n"Parts we cannot make. All of it sells on Halcyon Boulevard, and the last of it is behind the clinic counter, and you will be waiting there a while."\n\nShe slides the list across.\n\n"They will offer you things while you wait. They are very good at it, they will be kind about it, and there is a discount for anybody who looks like they are thinking it over." A beat. "I am not telling you not to. I am telling you I will be here when you get back, and so will the ledger."',
      accept: '"Bring the parts back. And bring yourself back." She does not look away as you go, and does not pretend she is doing anything else.',
      report: 'She counts the parts, and then the change, and then she looks at you — at your hands, at the sides of your throat, at the way you are standing — for a great deal longer than four seconds.\n\n"Right," says the Quartermaster, and writes something in the first ledger.',
      acceptLabel: 'I know what this is.',
      declineLabel: 'Ask somebody else.',
      doneLabel: 'And myself.',
      rewardNote: '(let her look)',
    }),
  });

  npc.dialogue_tree.root.options = [
    ...stripMine(npc.dialogue_tree.root.options).filter((o) => o.next !== 'bye'),
    mine({ next: 'teach', label: 'Will you teach me?', conditions: [MEMBER] }),
    ...rootPair('carry', 'quest_lw_fav_carry', {
      offerLabel: 'Anything missing from the books?',
      reportLabel: 'Your cache is on the counter.',
      extra: [MEMBER],
    }),
    ...rootPair('loyalty', 'quest_lw_loyalty', {
      offerLabel: 'Is there something harder?',
      reportLabel: 'Parts, and the change.',
      extra: [MEMBER, { ideology_rep: LW, tier: 'trusted' }],
    }),
    { next: 'bye', label: 'Nothing today.' },
  ];

  save(npc);
}

// ── Teague, in the Under: the ceiling ───────────────────────────────────────
{
  const npc = load('npc_lw_teague');
  npc.flags = {
    ...npc.flags,
    mastery_instructor: {
      disciplines: ['movement', 'pain', 'mind', 'combat'],
      rep_required: 900,   // Inner Circle
      max_rank: 100,
    },
  };

  Object.assign(npc.dialogue_tree, {
    teach: {
      text: 'Teague looks at you for long enough that the lantern on her belt stops swinging.\n\n"Someone sent you all the way down here, so someone thinks you are worth the walk." She unslings the carbine and leans it against the wall, muzzle down, which is not a small thing. "Moving. Pain. Keeping your head. Fighting, when it comes to that, and it does."\n\n"There is no ceiling on what I can show you and there is a hard one on what you can hold, and it is your own body, and you brought it here yourself. `train` and name the thing."',
      options: [{ next: 'bye', label: 'Movement, then.' }],
    },
    ...questNodes('quiet', {
      questId: 'quest_lw_fav_quiet',
      offer: '"There is a man on Foundry Way counting doorways." Teague says it flatly. "Municipal. Damp. Harmless as a person and not harmless as a ledger, because in six weeks somebody upstairs will have a list of every door in the quarter that opens."\n\n"Stop the counting. Leave the counter." Her eyes come up. "I want to be understood on the second half. We do not leave bodies. Not because we are gentle — because a body is a reason for somebody to come and look, and looking is the only thing that has ever hurt us."',
      accept: '"Across the back of the head, and walk away, and let him wake up cold and confused and alive."',
      report: '"And he is breathing." She does not make you say it twice. "Good. In a month he will tell it as the night he was mugged on Foundry Way, which is a story nobody investigates."',
      acceptLabel: 'Alive. Understood.',
      declineLabel: 'Find somebody with fewer scruples.',
      doneLabel: 'Cold and confused.',
      rewardNote: '(nothing to add)',
    }),
  });

  npc.dialogue_tree.root.options = [
    ...stripMine(npc.dialogue_tree.root.options).filter((o) => o.next !== 'bye'),
    mine({ next: 'teach', label: 'They said you could teach me.', conditions: [MEMBER] }),
    ...rootPair('quiet', 'quest_lw_fav_quiet', {
      offerLabel: 'Anything down here need doing?',
      reportLabel: 'The counting has stopped.',
      extra: [MEMBER, { ideology_rep: LW, tier: 'trusted' }],
    }),
    { next: 'bye', label: 'Nothing.' },
  ];

  save(npc);
}

// ── Halloran: the bench ─────────────────────────────────────────────────────
{
  const npc = load('npc_lw_halloran');

  Object.assign(npc.dialogue_tree, questNodes('bench', {
    questId: 'quest_lw_fav_bench',
    offer: '"I do not need the help." He says it while clearing a space at the bench, and then says it again, and keeps clearing.\n\n"The Watch run on things that were made rather than bought. That is not a philosophy, it is a supply problem — nobody sells us anything and the ones who would want paying in the wrong currency. So the making gets done by whoever is standing there."\n\nHe pushes a stool out with his foot without turning round.\n\n"Today that is you."',
    accept: '"Make me something. I do not much care what. I care that it came out of your hands."',
    report: 'Halloran turns it over twice, the way he turns everything over, and puts it on the shelf with the rest instead of handing it back. Which is the review.',
    acceptLabel: '(sit down at the bench)',
    declineLabel: 'Another day.',
    doneLabel: 'Out of my hands.',
    rewardNote: '(leave it on the shelf)',
  }));

  npc.dialogue_tree.root.options = [
    ...stripMine(npc.dialogue_tree.root.options).filter((o) => o.next !== 'bye'),
    ...rootPair('bench', 'quest_lw_fav_bench', {
      repeatable: true,
      offerLabel: 'Need a pair of hands at the bench?',
      reportLabel: 'I made you something.',
      extra: [MEMBER],
    }),
    { next: 'bye', label: 'Later.' },
  ];

  save(npc);
}

// ── Nyall: the chalked camera ───────────────────────────────────────────────
{
  const npc = load('npc_lw_nyall');

  Object.assign(npc.dialogue_tree, questNodes('eye', {
    questId: 'quest_lw_fav_eye',
    offer: 'The old man taps the chalk stub against the wall twice before he uses it.\n\n"Meltwater side. There is an eye over a doorway that people need, and it has been there four months, and folk have started going the long way round." He writes something on the brick that you cannot read. "That is it on the list. It has been on the list a while."\n\n"Go and close it. And do not be a story afterwards — a blind spot everyone has heard about is just a place people get arrested."',
    accept: '"Mind the angles going in. The eye is not the only thing on that street with an opinion."',
    report: 'Nyall licks the chalk stub, finds the mark on the wall, and draws a line through it with what is unmistakably satisfaction.\n\n"That doorway is a doorway again," he says.',
    acceptLabel: "I'll close it.",
    declineLabel: 'Not my sort of work.',
    doneLabel: 'Mind the angles.',
    rewardNote: '(watch him strike it out)',
  }));

  npc.dialogue_tree.root.options = [
    ...stripMine(npc.dialogue_tree.root.options).filter((o) => o.next !== 'bye'),
    ...rootPair('eye', 'quest_lw_fav_eye', {
      repeatable: true,
      offerLabel: "What's on the wall today?",
      reportLabel: 'That eye is closed.',
      extra: [MEMBER],
    }),
    { next: 'bye', label: 'Nothing.' },
  ];

  save(npc);
}

console.log('done.');
