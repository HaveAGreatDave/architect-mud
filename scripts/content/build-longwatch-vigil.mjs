/**
 * Phase 3 — The Long Watch pack: the mirror of the Ascendant arc, and the
 * discipline's missing front door.
 *
 * THE THING FOUND ON THE WAY IN. Mastery ships as built and documented, with a
 * `train` verb, a rep gate, a purity cap and an instructor config — and **not
 * one NPC in the world carried `flags.mastery_instructor`**. There was no
 * teacher anywhere in the Basin, so `train` could only ever answer "nobody here
 * teaches that". The Long Watch's entire discipline was unreachable. Placing the
 * three instructors below is therefore not decoration on this arc; it is the
 * arc's reason to exist, and it doubles as the reward ladder.
 *
 * WHY THIS IS NOT A COPY OF THE ASCENDANT ARC. docs/systems-mastery.md is
 * explicit that a Long Watch veteran must not look supernatural on inspection,
 * so the order grants no permanent passive at all and its rite cannot be a thing
 * DONE TO YOU. Hence the deliberate inversions:
 *
 *   Ascendants                        Long Watch
 *   climbing buys better HARDWARE  →  climbing buys better TEACHERS
 *   the test is one irreversible    →  the test is a DURATION you can blow at
 *     act (getting chromed)              any moment inside it
 *   the rite is an upload; you die  →  the rite is a vigil; you sit still and
 *     in white fire                      nothing whatsoever happens
 *   the way out is the Exodus chair →  the way out is the Ascendant clinic
 *
 * THE RITE NEEDS NO VERB, and that is the point. The Ascendants needed `ascend`
 * because dying has to be triggered. Standing a watch is the absence of action,
 * so it is a `visit` with a long `taskSeconds` — and the engine's existing rule
 * that ANY non-passive command cancels a tile task IS the test. Nobody wrote a
 * failure state for it; the player simply has to sit there.
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const ROOT = path.resolve(process.cwd(), 'content');
const stamp = String(Math.floor(Date.now() / 1000));
const LW = 'ideology_long_watch';
const ASC = 'ideology_ascendants';

const write = (dir, obj) => {
  const file = path.join(ROOT, dir, `${obj.id}.json`);
  const existed = fs.existsSync(file);
  fs.writeFileSync(file, canonicalJson(obj), 'utf8');
  console.log(`  ${existed ? 'updated' : 'created'} content/${dir}/${obj.id}.json`);
};
const quest = (o) => ({
  category: null, fail_on: [], meta: {}, penalties: {},
  quest_type: 'standard', repeatable: 0, updated_at: stamp, ...o,
});

console.log('— Long Watch favour work —');

// Halloran's bench. `craft` is the only objective type that already means "made
// with your own hands", which is the Watch's entire argument about themselves.
write('quests', quest({
  id: 'quest_lw_fav_bench',
  name: 'Bench Time',
  repeatable: 1,
  description: "Halloran does not need the help and says so, twice, while clearing you a space at the bench. The Watch run on things that were made rather than bought, and the making is done by whoever is standing there. Today that is you.",
  objectives: [
    {
      id: 'o_make', type: 'craft', count: 1,
      desc: 'Make something. Anything. Bring it back made rather than bought.',
      emotes: ['{who} works with their hands and does not look up for a while.'],
    },
  ],
  rewards: { credits: 45, xp: 14, rep: [{ ideology: LW, delta: 45 }] },
}));

// The Watch's actual day work, and the inverse of the Ascendant loyalty mission
// — they close the eyes that arc reopens. Both constraint conditions, because a
// blinding that gets seen is worse than one that never happened.
write('quests', quest({
  id: 'quest_lw_fav_eye',
  name: 'Closing an Eye',
  repeatable: 1,
  description: "There is a camera on the Meltwater side that has been looking at a doorway people need to use. Nyall has chalked the wall under it, which is his way of putting a thing on the list. Go and close it, and do not be a story afterwards.",
  objectives: [
    {
      id: 'o_reach', type: 'visit', zone: 'zone_district_907_912', taskSeconds: 6,
      desc: 'Get under the camera on Meltwater Row and wait for the street to lose interest.',
      emotes: ['{who} stands in a doorway doing nothing at all, which takes practice.'],
    },
    {
      id: 'o_close', type: 'hack', zone: 'zone_district_907_912', count: 1, requires: ['o_reach'],
      desc: 'Close the eye.',
    },
  ],
  fail_on: [
    { type: 'spotted', desc: 'Somebody watched you do it. A blind spot everyone knows about is just a place people get arrested.' },
    { type: 'witnessed', desc: 'Another lens had you the whole time. The Watch will have to start again somewhere else.' },
  ],
  rewards: { credits: 130, xp: 26, rep: [{ ideology: LW, delta: 65 }] },
}));

// The mirror of the Ascendants' "Lapsed": the same verb, the opposite reason.
// They leave you breathing so you can resume payments; the Watch leave you
// breathing because killing you was never the job.
write('quests', quest({
  id: 'quest_lw_fav_quiet',
  name: 'Quiet Hands',
  description: "One of the Architect's little servants has been counting doors on Foundry Way and writing the numbers down. Teague wants the counting stopped and the counter left alive, and is unusually direct about the second half: the Watch do not leave bodies, because a body is a reason for somebody to come and look.",
  objectives: [
    {
      id: 'o_down', type: 'subdue', target: 'npc_civic_counter', count: 1,
      desc: 'Put the census clerk down and leave them breathing.',
      emotes: ['{who} waits for the clipboard to come up, and takes them across the back of the head.'],
    },
  ],
  fail_on: [
    { type: 'assassinate', target: 'npc_civic_counter', desc: 'You killed them. Now there is a body on Foundry Way, and a body is a reason for somebody to come and look.' },
  ],
  rewards: { credits: 150, xp: 28, rep: [{ ideology: LW, delta: 70 }] },
}));

// The unglamorous one, and the one that is most what the order is called.
write('quests', quest({
  id: 'quest_lw_fav_sit',
  name: 'A Turn on the Blind',
  repeatable: 1,
  description: "Somebody has to sit the post while somebody else sleeps. The Blind looks down the length of the wash and the shortwave mutters to itself, and the whole of the job is that you are there and awake. Pike will not thank you. Pike has sat it ten thousand times.",
  objectives: [
    {
      id: 'o_sit', type: 'visit', zone: 'zone_lw_blind', taskSeconds: 30,
      desc: 'Sit the post at the Blind. Do not open the door.',
      emotes: [
        '{who} watches the mirror down the length of the wash, and nothing comes.',
        '{who} listens to the shortwave mutter, and nothing in it is for them.',
        '{who} shifts once on the stool and settles again.',
      ],
    },
  ],
  rewards: { credits: 40, xp: 12, rep: [{ ideology: LW, delta: 40 }] },
}));

// Carrying, which is most of what an underground actually does.
write('quests', quest({
  id: 'quest_lw_fav_carry',
  name: 'Carry It Back',
  description: "The Quartermaster keeps a ledger of everything the Watch owns and a shorter one of everything it has lost. There is a cache under the Fisherman's Green that has been on the second list for a month, which she considers a personal failing. It is not a dangerous errand. She would like it back all the same.",
  objectives: [
    {
      id: 'o_get', type: 'retrieve', item_id: 'item_lw_package', zone: 'zone_district_909_912',
      count: 1, desc: "Recover the cache from under the Fisherman's Green.",
    },
    {
      id: 'o_home', type: 'visit', zone: 'zone_lw_bunk', taskSeconds: 5, requires: ['o_get'],
      desc: 'Carry it back to the Quartermaster.',
      emotes: ['{who} sets it on the counter and waits to be told which shelf.'],
    },
  ],
  rewards: { credits: 110, xp: 22, rep: [{ ideology: LW, delta: 55 }] },
}));

// ── The loyalty test ────────────────────────────────────────────────────────
//
// A DURATION, not an act, and the mirror of "Restoring Service" in every way
// that matters. They do not ask you to hurt anybody. They send you into the one
// place in the Basin where the shortcut is on a shelf at eye height, give you a
// reason to be there for a long time, and see whether you come back the same
// shape. The `install`/`mutate` fail conditions are the entire mission.
write('quests', quest({
  id: 'quest_lw_loyalty',
  name: 'Nothing Bought',
  description: "The Quartermaster hands you a purse heavy enough to be a point, and a list of parts the Watch cannot make and will not do without. All of it is sold on Halcyon Boulevard, and the clinic on that same street will fit you anything you like while you wait, at a discount, to anybody who looks like they are considering it.\n\nShe does not tell you not to. She says: bring the parts back, and bring yourself back, and she watches you the whole way to the door.",
  objectives: [
    {
      id: 'o_street', type: 'visit', zone: 'zone_district_894_907', taskSeconds: 10,
      desc: 'Work the length of Halcyon Boulevard for the parts on the list.',
      emotes: ['{who} works down the list, counter by counter, and is offered something better at every one of them.'],
    },
    {
      id: 'o_wait', type: 'visit', zone: 'zone_asc_clinic_consult', taskSeconds: 20, requires: ['o_street'],
      desc: 'The last part is behind the clinic counter. Wait for it.',
      emotes: [
        '{who} sits in a warm, clean waiting room while somebody explains what could be done about the ache in their hands.',
        '{who} is handed a brochure, and holds it, and does not read it.',
      ],
    },
    {
      id: 'o_back', type: 'visit', zone: 'zone_lw_bunk', taskSeconds: 5, requires: ['o_wait'],
      desc: 'Take the parts back to the Quartermaster.',
      emotes: ['{who} puts the parts and what is left of the purse on the counter, in that order.'],
    },
  ],
  fail_on: [
    { type: 'install', desc: 'You had something fitted. The parts are on the counter and so is the receipt, and the Quartermaster reads the second one first.' },
    { type: 'mutate', desc: 'You came back a different shape. The Watch have a word for that and it is not one they say to your face.' },
  ],
  rewards: {
    credits: 400, xp: 85,
    rep: [{ ideology: LW, delta: 220 }, { ideology: ASC, delta: -60 }],
    flags: [{ scope: 'player', flag: 'lw_loyal', value: 'done' }],
  },
}));

// ── The rite ────────────────────────────────────────────────────────────────
//
// The Long Watch, done as a verb-less quest, because standing a watch is the
// absence of action. The engine already cancels a tile task on any non-passive
// command (NON_CANCELLING_CMDS in plugins/quests), so the ONLY way to fail this
// is to do something, and the only way to pass it is to do nothing for longer
// than is comfortable. There is no failure message and no penalty: you simply
// have to sit it again, which is the most Long Watch outcome available.
write('quests', quest({
  id: 'quest_lw_rite',
  name: 'The Long Watch',
  description: "There is no ceremony. Pike gets off the stool, and does not explain, and does not come back.\n\nYou sit the Blind alone until somebody relieves you. The mirror shows the length of the wash. The shortwave mutters. Nothing happens, and nothing is supposed to, and the entire point of the order you are joining is that somebody was sitting here the whole time anyway.\n\nDo not open the door. Do not go and check. Do not do anything at all.",
  objectives: [
    {
      id: 'o_watch', type: 'visit', zone: 'zone_lw_blind', taskSeconds: 180,
      desc: 'Stand the watch. Anything you do ends it and you start again.',
      emotes: [
        '{who} watches the mirror, and the wash is empty, and stays empty.',
        '{who} stops noticing the shortwave, which is the first useful thing that happens.',
        '{who} has been here long enough to hear the base breathing above them.',
        '{who} does not check the door. There is nothing at the door.',
        '{who} sits, and the hours the Watch are named for start to mean something.',
      ],
    },
  ],
  rewards: {
    credits: 0, xp: 220,
    rep: [{ ideology: LW, delta: 260 }],
    flags: [{ scope: 'player', flag: 'watch_kept', value: 'done' }],
  },
}));

// ── The census clerk ────────────────────────────────────────────────────────
//
// A person, deliberately, and not an enemy row: `subdue` names a PERSON and the
// quest's whole point is that killing them is the failure state. Making them an
// enemy would put them on the auto-attack path and settle the question for you.
console.log('— the counter —');
write('npcs', {
  id: 'npc_civic_counter',
  name: 'Wexley Tolliver',
  sex: 'male',
  npc_type: 'civilian',
  faction: null,
  hp: 26, hp_max: 26,
  home_zone: 'zone_district_912_912',
  work_zone_id: 'zone_district_912_912',
  studio_zone_id: null,
  description: 'A damp, apologetic man with a clipboard held against his chest like a shield, counting doorways on Foundry Way and writing each one down. He has a lanyard nobody has ever asked to see and the specific patience of somebody paid by the hour to do something pointless.',
  chitchat: [
    '"Doorways. That is all. I do not ask what is behind them, that is a different department."',
    '"It is a job. You do not have to like the ledger to eat off it."',
  ],
  banter: [], home_activities: [],
  vendor_inventory: [], vendor_restock_rate: 1, vendor_schedule: {},
  vendor_shop_name: null, vendor_stock_size: 10, wander_zones: [], wanders: 0,
  flags: {
    personality: 'clerk',
    clothing_layers: [
      'a municipal weatherproof two sizes too big',
      'a knitted tie under a damp collar',
      'shoes that were never meant to be walked in this much',
    ],
    mis_willing: false,
  },
  behaviour_graph: { _start: 'start', nodes: { start: { next: 'wait', type: 'start' }, wait: { next: 'start', seconds: 75, type: 'wait' } } },
  dialogue_tree: {
    root: {
      first: 'He looks up from the clipboard, sees somebody who is not a doorway, and is briefly at a loss. "Ah. Are you — is this your door?"',
      text: 'He has moved eleven feet along the street and is counting again. "Still going. Long street."',
      options: [
        { next: 'why', label: 'What are you counting?' },
        { next: 'bye', label: '(leave him to it)' },
      ],
    },
    why: {
      text: '"Doorways." He shows you the clipboard as though it settles something. "Every one on the Row, and whether it opens. I do not ask what is behind them. That is a different department and I have never met anybody from it."\n\nHe writes another number down.\n\n"It is a job. You do not have to like the ledger to eat off it."',
      options: [{ next: 'bye', label: 'No. You do not.' }],
    },
    bye: { text: 'He goes back to the doorways.', options: [] },
  },
});

console.log('done.');
