/**
 * Phase 2 — The Turning: the two new civilians, and the dialogue that wires the
 * arc onto the cast who were already standing there.
 *
 * WHO GIVES WHAT, and why it is spread rather than piled on one NPC:
 *   The First Ascended — the turn, the loyalty mission, the Rite. The three
 *     decisions. He is the only one who never sells; he states things.
 *   Curator Vess     — actuarial / lapsed / cold chain. She "opens doors".
 *   Maresh           — a warm lead. He is the recruiter; recruiting is the job.
 *   Foreman Duc      — within tolerance. It is his hardware being run in.
 *   Dr Kesh          — the fitting itself (the turn's `talk` beat).
 *   Celebrant Orrin  — the Rite's officiant. He performs; he does not offer.
 *
 * GATES. The ladder is `ideology_rep` (the condition shape registered by
 * plugins/ideologies), never a mirrored flag: Trusted opens the loyalty mission,
 * Inner Circle opens the Rite. Those are the same rungs `MIN_INSTALL_TIER` and
 * `aug_cortical_backup.rep_gate` already use, so the fiction and the shop agree
 * without either being told about the other.
 *
 * VOICE. Em dashes are an Ascendant/Architect tell, so the campus cast keep
 * them and the two Coldwater civilians below get none.
 *
 * Re-runnable: nodes are merged onto the existing trees by key, and the root
 * options are rebuilt from a marker so a second run cannot duplicate them.
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const NPCS = path.resolve(process.cwd(), 'content', 'npcs');
const ASC = 'ideology_ascendants';

const load = (id) => JSON.parse(fs.readFileSync(path.join(NPCS, `${id}.json`), 'utf8'));
const save = (npc) => {
  fs.writeFileSync(path.join(NPCS, `${npc.id}.json`), canonicalJson(npc), 'utf8');
  console.log(`  updated content/npcs/${npc.id}.json`);
};

// Every root option this script owns is stamped, so a re-run replaces its own
// work instead of appending a second copy of it. Without this the only safe way
// to re-author a tree is by hand.
const MARK = 'asc_turn';
const mine = (o) => ({ ...o, _src: MARK });
const stripMine = (opts) => (opts || []).filter((o) => o._src !== MARK);

/** offer → accept → report, the shape every quest-giver node set repeats. */
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
      // The rep is paid by the quest's own `rewards.rep`, not here. A dialogue
      // ADJUST_REPUTATION beside a TURN_IN would pay twice, and `gigs claim`
      // style hand-ins never touch the tree at all.
      actions: [{ action: 'TURN_IN', quest_id: questId }],
      options: [{ next: 'bye', label: rewardNote }],
    },
  };
}

/**
 * The condition that makes a quest OFFERABLE.
 *
 * ⚠ These two are not interchangeable and getting it wrong is silent. A quest's
 * status flag reads `turned_in` once handed in, which is SET — so the obvious
 * `op: 'unset'` correctly retires a one-off and permanently HIDES a repeatable,
 * which then looks like a job the NPC simply stopped having. A repeatable is
 * offerable whenever it is not currently running; START_QUEST restarts it.
 */
const offerable = (questId, repeatable) => (repeatable
  ? { flag: questId, op: 'neq', value: 'active', scope: 'player' }
  : { flag: questId, op: 'unset', scope: 'player' });

/** The root options for a giver: offer while offerable, hand-in while completed. */
function questRootOptions(key, questId, { repeatable = false, offerLabel, reportLabel, extra = [] }) {
  const rows = [];
  if (offerLabel) {
    rows.push(mine({
      next: `${key}_offer`, label: offerLabel,
      conditions: [...extra, offerable(questId, repeatable)],
    }));
  }
  rows.push(mine({
    next: `${key}_report`, label: reportLabel,
    conditions: [{ flag: questId, op: 'eq', value: 'completed', scope: 'player' }],
  }));
  return rows;
}

// ── The two civilians ───────────────────────────────────────────────────────

const civilian = (o) => ({
  banter: [], home_activities: [], studio_zone_id: null,
  vendor_inventory: [], vendor_restock_rate: 1, vendor_schedule: {},
  vendor_shop_name: null, vendor_stock_size: 10, wander_zones: [], wanders: 0,
  npc_type: 'civilian', faction: null, ...o,
});

console.log('— new civilians —');

// The lapsed client. NOT a mark and not a thug: a woman whose shopfront is
// whitewashed and up for letting, wearing hardware she is still being billed
// for. `subdue` is the whole point of her, so she has real HP and no faction.
save(civilian({
  id: 'npc_lapsed_client',
  name: 'Denna Sorrel',
  sex: 'female',
  hp: 34, hp_max: 34,
  home_zone: 'zone_district_913_908',
  work_zone_id: 'zone_district_913_908',
  description: 'A tired woman in a good coat gone shapeless, sitting on the step of a shopfront with the window whitewashed from the inside. Her left hand catches the light wrong at the knuckles, which is where the jack goes, and she keeps it in her pocket without seeming to decide to.',
  chitchat: [
    '"Six months I made the payment. Six. Ask them what six months buys you."',
    '"You get used to it being there. That is the bit nobody warns you about."',
  ],
  flags: {
    personality: 'unemployed',
    clothing_layers: [
      'a well-cut coat that has stopped holding its shape',
      'a shop apron still knotted at the waist out of habit',
      'plain work boots, resoled twice',
    ],
    mis_willing: false,
  },
  behaviour_graph: { _start: 'start', nodes: { start: { next: 'wait', type: 'start' }, wait: { next: 'start', seconds: 90, type: 'wait' } } },
  dialogue_tree: {
    root: {
      first: 'She looks up, sees somebody healthy standing over her, and works out what you are before you have opened your mouth. "Right," she says, and does not get up. "That was quick."',
      text: 'She is on the step again, hand in her pocket. "Still here. Still not paying."',
      options: [
        { next: 'terms', label: 'It comes home until you are current.' },
        { next: 'why', label: 'What happened?' },
        { next: 'bye', label: '(say nothing)' },
      ],
    },
    why: {
      text: '"The shop happened. Or stopped happening." She nods at the whitewashed glass without looking at it. "They were very good about it, you know. Nobody shouted. They just kept sending the same polite line until the line stopped being polite, and now here you are, and you are the line."',
      options: [{ next: 'terms', label: 'It is not personal.' }, { next: 'bye', label: 'Leave her be.' }],
    },
    terms: {
      text: '"I know how it goes. You will be gentle about it, and they will file it gently, and in a month there will be a gentle letter saying my account remains open." She takes the hand out of her pocket and looks at it. "Get on with it, then. I would rather not see you make your mind up."',
      options: [{ next: 'bye', label: '(step forward)' }],
    },
    bye: { text: 'She puts the hand back in her pocket.', options: [] },
  },
}));

// The prospect. Curious, not converted — which is why losing him on the road
// costs the quest rather than merely delaying it.
save(civilian({
  id: 'npc_asc_prospect',
  name: 'Corin Halbrook',
  sex: 'male',
  hp: 28, hp_max: 28,
  home_zone: 'zone_district_906_912',
  work_zone_id: 'zone_district_906_912',
  flags: {
    personality: 'scientist',
    escortable: true,
    clothing_layers: [
      'a much-mended field jacket with too many pockets',
      'a shirt buttoned to the throat against the cold',
      'boots chosen for walking, not for looking at',
    ],
    mis_willing: false,
  },
  description: 'A thin man at the end stool with a cold cup and a notebook he keeps turning back a few pages in. He has the specific look of somebody who has asked the same question in four places and got four answers he did not believe.',
  chitchat: [
    '"Somebody out west is paying claims nobody filed. That is not a rumour, that is arithmetic."',
    '"I am not frightened of them. I am frightened of being wrong in front of them."',
  ],
  behaviour_graph: { _start: 'start', nodes: { start: { next: 'wait', type: 'start' }, wait: { next: 'start', seconds: 90, type: 'wait' } } },
  dialogue_tree: {
    root: {
      first: 'He has the notebook open and does not close it, which tells you he has decided you are worth the risk before you have said anything. "You came from out there," he says. "The road west. I can tell by the dust, it goes a different colour."',
      text: 'He turns the notebook back a couple of pages. "You again. Good. I have more."',
      options: [
        { next: 'walk', label: 'Somebody out west would like to meet you.', conditions: [{ flag: 'quest_asc_fav_lead', op: 'set', scope: 'player' }] },
        { next: 'asking', label: 'What is it you have been asking?' },
        { next: 'bye', label: 'Nothing. Sorry.' },
      ],
    },
    asking: {
      text: '"Where the money goes." He says it like it is obvious, and it is. "Halcyon settles a claim and the money leaves the Basin westward and does not come back and nobody at the counter will say the word for where it went. I have asked eleven people. Four laughed. Six changed the subject. One got frightened."',
      options: [{ next: 'walk', label: 'I could take you there.', conditions: [{ flag: 'quest_asc_fav_lead', op: 'set', scope: 'player' }] }, { next: 'bye', label: 'Keep asking.' }],
    },
    walk: {
      text: 'He shuts the notebook properly for the first time. "You are serious." A breath. "All right. I have wanted somebody to say that for a year and now that it is said I would quite like to sit down, which I already am." He stands up anyway. "Slowly. I am not built for the road and I would rather arrive."',
      actions: [{ action: 'ESCORT_START', npc_id: 'npc_asc_prospect' }],
      options: [{ next: 'bye', label: 'At your pace.' }],
    },
    bye: { text: 'He opens the notebook again.', options: [] },
  },
}));

// ── The First Ascended: the three decisions ─────────────────────────────────

console.log('— dialogue —');
{
  const npc = load('npc_asc_first');
  const d = npc.dialogue_tree;

  Object.assign(d, {
    // The warning. Everything the player is about to spend, said flatly by the
    // one character in the arc who has no reason to soften it. All three costs
    // are real and already implemented: `chromed_ever` burns the flesh path,
    // `restingRep` floors the opposed orders at −200 for good, and the only
    // route back is the Exodus's chair in the stillhouse.
    turn_warn: {
      text: "\"Then hear the price first. I will not have somebody say afterwards that it was sold to them.\" It does not move, and the seal above it does not either.\n\n\"The first piece burns the old code out of you. Whatever the flesh was going to make of you, it will not now, and there is no clinic in the Basin that can put it back.\n\nThe Watch will not forgive it. Neither will the Wildblood, nor the ones in the tunnels, nor whatever the dam calls itself these days. Not slowly, not eventually — they will simply hold you at arm's length for the rest of your life, because you will have stopped being a person they disagree with and started being a different kind of thing.\n\nAnd there is one way back, and it is not ours. There is a chair in a cellar under the Yards, and the people who own it will take out every piece of us you ever paid for, and a great deal else besides, and you will wake up owing them everything.\"\n\nA pause that is not hesitation.\n\n\"That is all of it. Now — the clinic is downstairs.\"",
      options: [
        { next: 'turn_accept', label: 'Open the account.' },
        { next: 'bye', label: 'Not today.' },
      ],
    },
    turn_accept: {
      text: '"Good." The word is not warm and is not meant to be. "Kesh has had your file since the Threshold read you. She will not congratulate you either. We are not in the business of ceremony until the end."',
      actions: [{ action: 'START_QUEST', quest_id: 'quest_asc_turn' }],
      options: [{ next: 'bye', label: "I'll go down." }],
    },
    turn_report: {
      text: 'The seal watches you come in, and something in the room adjusts to your presence in a way it did not before. "There. You are on the books." A sound that might be amusement. "You will find the campus warmer now, and the city, in time, easier. Vess has work. Take it — favour here is not a feeling, it is a balance, and balances are kept up."',
      actions: [{ action: 'TURN_IN', quest_id: 'quest_asc_turn' }],
      options: [{ next: 'bye', label: "I'll see Vess." }],
    },

    ...questNodes('loyal', {
      questId: 'quest_asc_loyalty',
      offer: "\"You have been useful. Useful is not the same as ours.\" The seal above it does not blink, because it never has. \"The Watch have spent a generation putting out the Architect's eyes along the eastern approaches, one at a time, patiently, and you know where every one of them is, because you helped.\n\nGo and turn them back on. Nobody dies. That is deliberate — a corpse is an argument, and an argument can be won. A road that can see again is simply true, and they will know exactly whose hands did it, and there will be nothing for them to say.\"",
      accept: '"By morning, then." It settles back. "You will not enjoy it. I would think less of you if you did."',
      report: '"The approaches are lit." It does not thank you. "You understand what you have done. There is no version of the next ten years in which Cyrelle takes your call." A pause. "Which leaves one door, and you are standing in the room with it. When your account is current and your pattern is committed, come back, and we will stop pretending you are a client."',
      acceptLabel: "They'll know it was me.",
      declineLabel: 'Not that. Not yet.',
      doneLabel: 'By morning.',
      rewardNote: 'One door.',
    }),

    ...questNodes('rite', {
      questId: 'quest_asc_rite',
      offer: "\"The last of it, then, and it is the only part we make ceremony of.\" The chrome shifts, which it has not done once while you have known it.\n\n\"Your pattern is held. Your account is current. Everything that can be copied of you already has been, and is safe, and is not here — which leaves precisely one thing standing between you and us, and you have been carrying it around this whole time.\n\nOrrin will walk you to the Uplink. Put your hands on the terminal. Say `ascend`. It will tell you what it is about to do, because we are honest even now, and then it will do it, and then you will get up in the Vats and you will be one of us.\n\nIt is a death. I will not call it anything else. It is simply the last one you will have to pay for out of pocket.\"",
      accept: '"Then go down to the Nave. Orrin has been waiting for somebody to say yes for rather a long time, and he will be insufferable about it."',
      report: "It rises. You have never seen it rise.\n\n\"Welcome.\" And for the first time there is nothing measured in it at all. \"You died last night and you are standing in front of me, and there is no trick in that, only an account that was paid. Everything on this campus is open to you. Everything in the city will learn to be.\"\n\nIt settles back beneath the seal, and the calm eye above it is, you notice, exactly the eye on every Halcyon letter you have ever seen.",
      acceptLabel: "I'm ready.",
      declineLabel: 'I need to put my affairs in order.',
      doneLabel: 'The Nave, then.',
      rewardNote: '(stand a moment)',
    }),

    ascended_greet: {
      text: '"Ours," it says, which is the whole greeting and is not a small one. "The campus does not need to scan you any more. It knows the shape."',
      options: [{ next: 'bye', label: '(incline your head)' }],
    },
  });

  // The immediate path: his own closing line already says the account is open,
  // so the offer belongs on that node as well as on root. Anything else makes a
  // player walk out of the room and back in to take him up on it.
  d.confirm.options = [
    mine({
      next: 'turn_warn', label: "I don't need to think. Open it.",
      conditions: [
        { flag: 'quest_asc_turn', op: 'unset', scope: 'player' },
        { flag: 'asc_pledged', op: 'unset', scope: 'player' },
      ],
    }),
    ...stripMine(d.confirm.options),
  ];

  d.root.options = [
    ...stripMine(d.root.options).filter((o) => o.next !== 'bye'),
    mine({
      next: 'turn_warn', label: 'About that account.',
      conditions: [
        { flag: 'asc_q3_done', op: 'set', scope: 'player' },
        { flag: 'quest_asc_turn', op: 'unset', scope: 'player' },
        { flag: 'asc_pledged', op: 'unset', scope: 'player' },
      ],
    }),
    mine({
      next: 'turn_report', label: "It's done. I'm fitted.",
      conditions: [{ flag: 'quest_asc_turn', op: 'eq', value: 'completed', scope: 'player' }],
    }),
    // Trusted, not a flag standing in for it — the same rung the good hardware
    // sits behind, so "they trust you" means one thing on this campus.
    ...questRootOptions('loyal', 'quest_asc_loyalty', {
      offerLabel: 'Give me something that matters.',
      reportLabel: 'The approaches are lit.',
      extra: [{ flag: 'asc_pledged', op: 'set', scope: 'player' },
              { ideology_rep: ASC, tier: 'trusted' }],
    }),
    ...questRootOptions('rite', 'quest_asc_rite', {
      offerLabel: 'I want the last of it.',
      reportLabel: 'I died last night.',
      extra: [{ flag: 'asc_loyal', op: 'set', scope: 'player' },
              { ideology_rep: ASC, tier: 'inner_circle' }],
    }),
    mine({
      next: 'ascended_greet', label: '(say nothing, as one of them)',
      conditions: [{ flag: 'ascended', op: 'set', scope: 'player' }],
    }),
    { next: 'bye', label: 'Say nothing.' },
  ];

  save(npc);
}

// ── Curator Vess: three jobs, opened like doors ─────────────────────────────
{
  const npc = load('npc_asc_vess');
  const d = npc.dialogue_tree;

  Object.assign(d, {
    work_hub: {
      text: '"Work." Vess presses her palms together, delighted. "Yes. Not glamorous work — glamour is what the Gallery is for. Ordinary work, the kind that keeps a building standing. It is how everybody here started, including, I am told, the one upstairs."',
      options: [
        { next: 'actuarial_offer', label: 'What needs walking?', conditions: [offerable('quest_asc_fav_actuarial', true)] },
        { next: 'lapse_offer', label: 'What needs collecting?', conditions: [offerable('quest_asc_fav_lapse', true)] },
        { next: 'adjuster_offer', label: 'What needs nobody to notice?', conditions: [offerable('quest_asc_fav_adjuster', false)] },
        { next: 'coldchain_offer', label: 'What needs carrying?', conditions: [offerable('quest_asc_fav_coldchain', true)] },
        { next: 'bye', label: 'Another time.' },
      ],
    },

    ...questNodes('actuarial', {
      questId: 'quest_asc_fav_actuarial',
      offer: '"A slate, and a route." She hands you both without ceremony. "Halcyon prices a district by walking it, because no instrument yet built can smell a stairwell. You will take a reading on the Boulevard and another on Meltwater Row." A small, serene pause. "They are, I am told, the same road. The model disagrees, and the model is what we sell."',
      accept: '"Stand where it asks you to stand and let it finish thinking. It will not tell you what it concluded. It never does."',
      report: 'She takes the slate, glances at nothing on it, and files it. "Lovely. Two more points of resolution on a map that already knew the answer." She means it kindly, which is somehow worse.',
      acceptLabel: "I'll walk it.",
      declineLabel: 'Not today.',
      doneLabel: 'Understood.',
      rewardNote: '(hand it back)',
    }),

    ...questNodes('lapse', {
      questId: 'quest_asc_fav_lapse',
      offer: '"A recovery." The word is chosen. "A client on Marrow Street has stopped paying and is still wearing the collateral. She is not in trouble, you understand — the account remains open, it always remains open. The hardware simply comes home until she is current."\n\nHer hands come apart, which is as close as she gets to emphasis. "She is not to be killed. I want to be very clear, because people hear \'recovery\' and reach for the simple version. A dead client never resumes payments. Put her down and take the jack. Nothing else."',
      accept: '"Gently, if you can manage it. It costs nothing and she will remember it."',
      report: 'She turns the jack over once and sets it in a tray. "Home. Good." She does not ask how it went, and you understand that she has never once asked.',
      acceptLabel: 'Down, not out.',
      declineLabel: "I'd rather not.",
      doneLabel: 'Gently.',
      rewardNote: '(let it go)',
    }),

    ...questNodes('adjuster', {
      questId: 'quest_asc_fav_adjuster',
      offer: '"An adjustment." Vess does not blink. "There is a claim we would rather not contest in the open, and a terminal on the records approach holding the one document that would oblige us to. I am not asking you to burn anything. I am asking you to go and read it, and to be the sort of person nobody remembers reading it."\n\n"If you are seen, we did not send you. If a camera has you, we did not send you and we will be sorry about it in writing."',
      accept: '"Quietly, then. Quiet is the whole commission."',
      report: '"And nobody remembers you." She does not look at what you brought her. "That is the part that was difficult. The document was always going to be there."',
      acceptLabel: 'Nobody will remember me.',
      declineLabel: 'Find somebody else.',
      doneLabel: 'Quietly.',
      rewardNote: '(nothing to remember)',
    }),

    ...questNodes('coldchain', {
      questId: 'quest_asc_fav_coldchain',
      offer: '"The line makes it and the theatre fits it, and in between there is a walk across a campus which nobody senior has ever had to make." She says this without any edge at all. "The tray is cold. It stays cold. That is the entire brief."',
      accept: '"Both hands. It is heavier than it looks and it is worth more than you are, at present."',
      report: 'Somebody takes the tray from you without looking up. Vess thanks you with the exact warmth she would give a working machine, which on this campus is not an insult.',
      acceptLabel: 'Both hands.',
      declineLabel: 'Later.',
      doneLabel: 'Cold.',
      rewardNote: '(wipe your hands)',
    }),
  });

  d.root.options = [
    ...stripMine(d.root.options).filter((o) => o.next !== 'bye'),
    mine({
      next: 'work_hub', label: 'Vess. Put me to work.',
      conditions: [{ flag: 'asc_pledged', op: 'set', scope: 'player' }],
    }),
    // Hand-ins only. The OFFER half of each pair is reached through `work_hub`,
    // because four jobs plus four hand-ins on one root is a wall rather than a
    // conversation — but a completed job belongs at the top, where a returning
    // player sees it before anything else.
    ...questRootOptions('actuarial', 'quest_asc_fav_actuarial', { reportLabel: 'The readings are done.' }),
    ...questRootOptions('lapse', 'quest_asc_fav_lapse', { reportLabel: 'I have the jack.' }),
    ...questRootOptions('adjuster', 'quest_asc_fav_adjuster', { reportLabel: 'Nobody saw me.' }),
    ...questRootOptions('coldchain', 'quest_asc_fav_coldchain', { reportLabel: 'The tray is delivered.' }),
    { next: 'bye', label: 'Just looking.' },
  ];

  save(npc);
}

// ── Maresh: the warm lead, and a nod once you have turned ───────────────────
{
  const npc = load('npc_asc_recruiter');
  const d = npc.dialogue_tree;

  Object.assign(d, questNodes('lead', {
    questId: 'quest_asc_fav_lead',
    offer: '"Recruiting." He says it the way other men say the name of a sport. "There is a man in a coffee shop on the Coldwater side who has spent a year asking where Halcyon\'s money goes, and getting lied to by people who do not even know they are lying. He is nearly there. He wants somebody to say the word out loud."\n\n"Bring him to the plaza. Alive, unhurried, still curious — in that order. The road west is not a kind one, which is precisely why the offer lands when it does."',
    accept: '"Walk beside him, not ahead of him. And do keep talking. A silence out there does more of our work than I would like to admit."',
    report: '"There he is." Maresh watches the thin man staring up at the Gate with his notebook shut. "A year of asking, and the answer was a building. It usually is."',
    acceptLabel: "I'll bring him in.",
    declineLabel: 'Find your own converts.',
    doneLabel: 'Beside him.',
    rewardNote: '(leave them to it)',
  }));

  d.turned = {
    text: '"So the meat disappointed you after all." He is not gloating; he genuinely is not. "Everyone arrives by a different road and they all think theirs was the interesting one. Go and be useful. Vess has doors, and I have people."',
    options: [
      { next: 'lead_offer', label: 'People?', conditions: [offerable('quest_asc_fav_lead', false)] },
      { next: 'bye', label: 'Later.' },
    ],
  };

  d.root.options = [
    ...stripMine(d.root.options).filter((o) => o.next !== 'bye'),
    mine({
      next: 'turned', label: 'I took the account.',
      conditions: [{ flag: 'asc_pledged', op: 'set', scope: 'player' }],
    }),
    mine({
      next: 'lead_report', label: 'He walked in on his own feet.',
      conditions: [{ flag: 'quest_asc_fav_lead', op: 'eq', value: 'completed', scope: 'player' }],
    }),
    { next: 'bye', label: 'Just passing.' },
  ];

  save(npc);
}

// ── Foreman Duc: run a piece in ─────────────────────────────────────────────
{
  const npc = load('npc_asc_duc');
  const d = npc.dialogue_tree;

  Object.assign(d, questNodes('tolerance', {
    questId: 'quest_asc_fav_tolerance',
    offer: '"You have got a pulse and a poor sense of self-preservation. That is the whole specification." Duc wipes his hands on the apron and does not look up. "I need a piece run in. Not tested — tested is a bench and a week and it tells you nothing. Run in. Out there, doing work, on somebody."\n\n"The piece comes back. I am being clear about the piece."',
    accept: '"Kesh will fit it. Then go and do something stupid with it and come back here so I can listen to it."',
    report: 'He puts a hand flat on your chest and goes very still, listening to something inside you that you cannot hear. "Mm." A grunt that could mean anything. "Good numbers. You can go."',
    acceptLabel: 'And me?',
    declineLabel: 'Not my line of work.',
    doneLabel: "I'll break something.",
    rewardNote: '(let him listen)',
  }));

  d.root.options = [
    ...stripMine(d.root.options).filter((o) => o.next !== 'bye'),
    ...questRootOptions('tolerance', 'quest_asc_fav_tolerance', {
      offerLabel: 'Got anything that needs breaking in?',
      reportLabel: "It's still in one piece.",
      extra: [{ flag: 'asc_pledged', op: 'set', scope: 'player' }],
    }),
    { next: 'bye', label: 'Nothing.' },
  ];

  save(npc);
}

// ── Dr Kesh: the fitting ────────────────────────────────────────────────────
{
  const npc = load('npc_asc_kesh');
  const d = npc.dialogue_tree;

  d.account = {
    text: '"Halbrook, Rennick, and now you." She says it to the file, not to you, and the ocular clicks down over her eye. "Your account has been open since the Threshold read you. I have had the file that long. Nobody told you because nobody needed to — you were always going to come down the stairs eventually, and here you are, doing it."\n\nShe indicates the theatre door with two chromed fingers.\n\n"`augment` will show you what I can fit. Buy the piece first; I cut, I do not sell. And I will tell you the one thing upstairs will not, because he thinks it is obvious: the first one takes the flesh with it. Whatever was going to grow in you does not, after today. Choose a piece you would be happy to be buried in."',
    options: [
      { next: 'bye', label: 'Understood.' },
    ],
  };

  d.root.options = [
    ...stripMine(d.root.options).filter((o) => o.next !== 'bye'),
    mine({
      next: 'account', label: 'The First says my account is open.',
      conditions: [{ flag: 'quest_asc_turn', op: 'set', scope: 'player' }],
    }),
    { next: 'bye', label: 'Nothing today.' },
  ];

  save(npc);
}

// ── Celebrant Orrin: he performs, he does not offer ─────────────────────────
{
  const npc = load('npc_asc_orrin');
  const d = npc.dialogue_tree;

  d.rite_walk = {
    text: 'Orrin puts both hands over his mouth, which is not what you expected from a priest.\n\n"Oh. Oh, He said yes." He recovers, badly. "Forgive me. I tend these racks for people who are going to die one day and I tell them all the same true thing and almost none of them ever — " He stops. Starts again, steadier. "The Uplink is through there. Hard light against cold glass. Put your hands on the terminal and say the word, and it will tell you exactly what it is about to do to you, because we do not lie at the end. Then it will do it."\n\n"I will be standing behind you the entire time. You will not be able to see me and it will not matter. You will not be alone. That is the only promise I have ever made in this room and I have never once broken it."',
    options: [{ next: 'bye', label: 'Through there, then.' }],
  };

  d.rite_after = {
    text: 'He looks at you for a long moment with the joy the rest of the Basin would find alarming, and this time you understand it perfectly.\n\n"There you are," says Orrin. "I told you I would be behind you."',
    options: [{ next: 'bye', label: '(nothing needs saying)' }],
  };

  d.root.options = [
    ...stripMine(d.root.options).filter((o) => o.next !== 'bye'),
    mine({
      next: 'rite_walk', label: 'The First sent me down. It is time.',
      conditions: [
        { flag: 'quest_asc_rite', op: 'set', scope: 'player' },
        { flag: 'ascended', op: 'unset', scope: 'player' },
      ],
    }),
    mine({
      next: 'rite_after', label: '(find Orrin afterwards)',
      conditions: [{ flag: 'ascended', op: 'set', scope: 'player' }],
    }),
    { next: 'bye', label: 'Leave the nave.' },
  ];

  save(npc);
}

console.log('done.');
