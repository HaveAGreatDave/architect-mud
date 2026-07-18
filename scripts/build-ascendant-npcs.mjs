// One-shot generator: the Ascendant Stronghold's NPCs + the 3-quest reveal chain
// (see docs/proposals/ascendant-stronghold.md). Writes canonical content JSON.
// The Q1 trailhead is added to Cyrelle (the Watch ops runner) by a separate edit —
// "the Watch sends you" — gated on lw_member (set by quest_lw_3).
//
//   node scripts/build-ascendant-npcs.mjs           # dry-run
//   node scripts/build-ascendant-npcs.mjs --write    # write files
//
// NOT testable until the campus zones are imported (content:import is blocked by
// other in-flight uncommitted content). Authored blind at the user's request.

import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, CONTENT_DIR } from './content/lib.mjs';

const WRITE = process.argv.includes('--write');
const NOW = '1783740000';
const npcPath = (id) => join(CONTENT_DIR, 'npcs', `${id}.json`);
const questPath = (id) => join(CONTENT_DIR, 'quests', `${id}.json`);

const IDLE = { _start: 'start', nodes: { start: { next: 'wait', type: 'start' }, wait: { next: 'start', seconds: 60, type: 'wait' } } };

function npc(o) {
  return {
    banter: [],
    behaviour_graph: IDLE,
    chitchat: o.chitchat || [],
    description: o.description,
    dialogue_tree: o.dialogue_tree,
    faction: o.faction ?? 'ideology_ascendants',
    flags: { clothing_layers: o.clothing_layers, mis_willing: false, personality: o.personality },
    home_activities: [],
    home_zone: o.zone,
    hp: o.hp ?? 30,
    hp_max: o.hp ?? 30,
    id: o.id,
    name: o.name,
    npc_type: 'civilian',
    sex: o.sex,
    studio_zone_id: null,
    wander_zones: [],
    wanders: 0,
    work_zone_id: o.zone,
  };
}

function quest(o) {
  return {
    category: null,
    description: o.description,
    id: o.id,
    meta: {},
    name: o.name,
    objectives: o.objectives,
    quest_type: 'standard',
    repeatable: 0,
    rewards: o.rewards,
    updated_at: NOW,
  };
}

const files = [];

/* ═══════════════════════════════ QUESTS ═══════════════════════════════════ */

files.push([questPath('quest_asc_1'), quest({
  id: 'quest_asc_1', name: 'Follow the Money',
  description: "Cyrelle's noticed it too: Halcyon Assurance settles its biggest claims by routing them west, past the grasslands, to somewhere that's on no map the Watch keeps. Watch the claims hall, follow the trail, and find out what's out there — without getting made.",
  objectives: [
    { id: 'o0', type: 'visit', zone: 'zone_halcyon_lobby', desc: 'Watch the claims hall in Halcyon Towers', taskSeconds: 5, emotes: ["{who} lingers by the claims-hall queue, counting how many payouts route somewhere nobody will name."] },
    { id: 'o1', type: 'visit', zone: 'zone_district_893_906', requires: ['o0'], desc: 'Follow the trail west (follow the green GPS line)', taskSeconds: 5, emotes: ["{who} follows the graded track west until the grass gives way to mirror-polished plaza — and a chrome wall of a place turns its scanners on {who}."] },
  ],
  rewards: { credits: 150, flags: [{ flag: 'asc_q1_done', scope: 'player', value: 'done' }] },
})]);

files.push([questPath('quest_asc_2'), quest({
  id: 'quest_asc_2', name: 'The Threshold',
  description: "The chrome fortress won't let baseline meat past the Gate — but a recruiter outside it says that's a solvable condition. Submit to the Ascension Gate scan and take their consultation pass. Whatever the Watch wanted you to find, you'll find it on the inside.",
  objectives: [
    { id: 'o0', type: 'visit', zone: 'zone_asc_gate_post', desc: 'Submit to the Ascension Gate scan', taskSeconds: 5, emotes: ["{who} steps under the scanline and lets the Gate read {who} down to the marrow."] },
  ],
  rewards: { credits: 0, flags: [{ flag: 'asc_q2_done', scope: 'player', value: 'done' }, { flag: 'ascendant_clearance', scope: 'player', value: 'done' }] },
})]);

files.push([questPath('quest_asc_3'), quest({
  id: 'quest_asc_3', name: 'Assurance for the Assured',
  description: "Inside at last. Curator Vess wants to show you the Spire the way the Ascendants show it to the promising: the ladder in the Gallery, a resurrection in the Vats, and whatever waits at the top. Walk it, and learn what Halcyon has really been selling.",
  objectives: [
    { id: 'o0', type: 'visit', zone: 'zone_asc_spire_gallery', desc: 'Walk the Gallery of Rungs', taskSeconds: 5, emotes: ["{who} walks the lit vitrines from crude jack to cortical backup, and feels the exhibit doing its quiet work."] },
    { id: 'o1', type: 'visit', zone: 'zone_asc_vats_hall', requires: ['o0'], desc: 'Witness a policy payout in the Vats', taskSeconds: 5, emotes: ["{who} watches a tank drain and a backed-up client sit up, blinking, alive on a paid account."] },
    { id: 'o2', type: 'visit', zone: 'zone_asc_spire_sanctum', requires: ['o1'], desc: 'Ascend to the Executive Sanctum', taskSeconds: 5, emotes: ["{who} rides to the crown of the Spire, where the seal waits — the same calm eye that watches every Halcyon claim."] },
  ],
  rewards: { credits: 300, flags: [{ flag: 'asc_q3_done', scope: 'player', value: 'done' }, { flag: 'halcyon_reveal', scope: 'player', value: 'done' }] },
})]);

/* ═══════════════════════════════ NPCS ═════════════════════════════════════ */

// 1. Warden Unit "Threshold" — the Gate's voice (guard post). No quest; pure gatekeeper flavour.
files.push([npcPath('npc_asc_warden'), npc({
  id: 'npc_asc_warden', name: 'Warden Unit "Threshold"', sex: 'male', personality: 'guard', zone: 'zone_asc_gate_post', hp: 60,
  description: "A seamless chrome carapace on two legs, faceless but for a single sweeping band of pale light that passes over you like a scanner because it is one. It does not shift its weight. It does not need to.",
  clothing_layers: ["a seamless chrome carapace, featureless but for a sweeping scanline eye", "no garment — the machine is the uniform"],
  chitchat: ["\"Deviation from baseline noted. Non-compliance is a choice.\"", "\"You may look. Looking is permitted. Withdraw when finished.\"", "\"The Threshold does not hate you. It simply does not admit you.\""],
  dialogue_tree: {
    bye: { options: [], text: "The scanline passes over you once more and dismisses you." },
    root: {
      options: [
        { label: 'What is this place?', next: 'what' },
        { label: 'Let me in.', next: 'refuse' },
        { label: 'Leave.', next: 'bye' },
      ],
      text: "The chrome unit registers you without warmth. \"Warden Unit designation Threshold. State nothing. I have already read everything about you that matters.\"",
    },
    what: { options: [{ label: 'Back.', next: 'root' }], text: "\"This is the beginning of the Ascendants, and the end of what you currently are. Past this Gate the meat becomes something worth keeping. You are, at present, only meat.\"" },
    refuse: { options: [{ label: 'Back.', next: 'root' }], text: "\"No. You carry no clearance and too much flesh. Speak to the recruiter if you wish that to change. Do not run the line. The turrets are not rhetorical.\"" },
  },
})]);

// 2. The recruiter — Q2 giver, stands OUTSIDE at the public Gate facade.
files.push([npcPath('npc_asc_recruiter'), npc({
  id: 'npc_asc_recruiter', name: 'Maresh, Ascendant Recruiter', sex: 'male', personality: 'politician', zone: 'zone_district_893_906',
  description: "An immaculate man in pale grey, a single chromed pin at his lapel catching the light. He smiles the way a door opens — smoothly, and for a reason. He has been waiting for someone exactly as promising, and as unimproved, as you.",
  clothing_layers: ["an immaculate pale-grey suit with a chromed lapel pin", "a collarless shirt buttoned to the throat", "polished shoes that never scuff"],
  chitchat: ["\"Death is a billing problem. We are simply the only ones honest enough to itemise it.\"", "\"You flinch at the chrome. Everyone does — right up until the day it saves them.\""],
  dialogue_tree: {
    bye: { options: [], text: "\"When the meat disappoints you — and it will — you know where the Gate is.\" He returns to his patient smile." },
    pitch: {
      options: [
        { label: "What do you want from me?", next: 'offer' },
        { label: "Not interested.", next: 'bye' },
      ],
      text: "\"The Watch sent you, didn't they. Suspicious of where Halcyon's money goes.\" He isn't offended; he's delighted. \"They're right, of course. It comes here. And you — you got close enough to be turned away, which means you're worth turning toward instead. Let me get you through that Gate. Properly.\"",
    },
    offer: {
      options: [
        { label: "Scan me, then.", next: 'accept' },
        { label: "Later.", next: 'bye' },
      ],
      text: "\"Nothing is asked of you but honesty — the Gate's kind. Step under the scanline in the post there and let the Threshold read you in full. It won't hurt. It will simply know you, and once it knows you, it will let you pass.\" The pin winks. \"Consider it a free consultation.\"",
    },
    accept: {
      actions: [{ action: 'START_QUEST', quest_id: 'quest_asc_2' }],
      options: [{ label: "Fine.", next: 'bye' }],
      text: "\"Wonderful. The post is just through the outer slab — the Warden will expect you.\" He steps aside like a maître d'. \"Come find me when it's done.\"",
    },
    report: {
      actions: [
        { action: 'TURN_IN', quest_id: 'quest_asc_2' },
        { action: 'ADJUST_REPUTATION', ideology_id: 'ideology_ascendants', delta: 120, reason: 'The Threshold' },
        { action: 'ADJUST_PATH', path: 'machine', delta: 5 },
      ],
      options: [{ label: "So I'm in.", next: 'inside' }],
      text: "\"There. The Threshold knows you now — you'll find its refusals have become invitations.\" He gestures west, toward the Spire. \"Curator Vess is expecting you on the concourse. Do try to keep an open mind. Or an open skull; we're flexible.\"",
    },
    inside: { options: [{ label: "I'll see Vess.", next: 'bye' }], text: "\"Up the plaza, the twisting tower — you can't miss it, it's the only honest building for miles.\"" },
    root: {
      options: [
        {
          conditions: [{ flag: 'asc_q1_done', op: 'set', scope: 'player' }, { flag: 'asc_q2_done', op: 'unset', scope: 'player' }, { flag: 'quest_asc_2', op: 'unset', scope: 'player' }],
          label: "You've been expecting me.", next: 'pitch',
        },
        {
          conditions: [{ flag: 'quest_asc_2', op: 'set', scope: 'player' }, { flag: 'asc_q2_done', op: 'unset', scope: 'player' }],
          label: "The Gate scanned me.", next: 'report',
        },
        {
          conditions: [{ flag: 'asc_q2_done', op: 'set', scope: 'player' }],
          label: "Anything else, Maresh?", next: 'inside',
        },
        { label: "Just passing.", next: 'bye' },
      ],
      text: "The immaculate man turns to you before you've said a word. \"Maresh. I recruit — which is to say I recognise. And I recognise something in you the Watch would rather I didn't.\"",
    },
  },
})]);

// 3. Curator Vess — Q3 giver (Spire concourse).
files.push([npcPath('npc_asc_vess'), npc({
  id: 'npc_asc_vess', name: 'Curator Vess', sex: 'female', personality: 'preacher', zone: 'zone_asc_spire_concourse',
  description: "A serene woman in circuit-blue-edged whites, a chromed half-collar rising behind her neck like a halo turned inward. She greets you with both hands and total certainty that you have come to be improved.",
  clothing_layers: ["flowing ceremonial whites edged in circuit-blue", "a chromed half-collar rising behind the neck", "soft slippers for the cathedral floor"],
  chitchat: ["\"We did not build a god to kneel before it. We built it to become it.\"", "\"Every rung looks like a loss from below, and like a gift from above.\""],
  dialogue_tree: {
    bye: { options: [], text: "\"Ascend well.\" She presses her palms together and is serene again." },
    tour_talk: {
      options: [{ label: "Show me, then.", next: 'accept' }, { label: "Maybe later.", next: 'bye' }],
      text: "\"Then let me show you the Spire the way we show it to the promising. The Gallery of Rungs, to see the ladder whole. The Vats, to see what waiting at the top actually buys. And then the crown — where you'll understand, finally, what Halcyon has been selling all along.\"",
    },
    accept: {
      actions: [{ action: 'START_QUEST', quest_id: 'quest_asc_3' }],
      options: [{ label: "Lead on.", next: 'bye' }],
      text: "\"Take the Gallery first — it's just inside. Walk it slowly. The exhibit does the persuading; I merely open the doors.\"",
    },
    root: {
      options: [
        {
          conditions: [{ flag: 'asc_q3_done', op: 'unset', scope: 'player' }, { flag: 'quest_asc_3', op: 'unset', scope: 'player' }],
          label: "What is all this?", next: 'tour_talk',
        },
        { label: "Just looking.", next: 'bye' },
      ],
      text: "\"Welcome, welcome — past the Gate at last.\" Curator Vess takes both your hands. \"I'm Vess. I greet those the Threshold judges worth greeting. You've no idea how few that is.\"",
    },
  },
})]);

// 4. The First Ascended — Q3 turn-in + the Halcyon reveal (Sanctum).
files.push([npcPath('npc_asc_first'), npc({
  id: 'npc_asc_first', name: 'The First Ascended', sex: 'male', personality: 'cult_member', zone: 'zone_asc_spire_sanctum', hp: 80,
  description: "More chrome than flesh, and what flesh remains is a courtesy to your comfort, not its own. Subdermal weave laces a throat that no longer strictly needs to speak. It regards you from beneath the great seal — the calm eye — as though it has been watching you through it the whole time.",
  clothing_layers: ["barely-there robes over more chrome than flesh", "a lattice of subdermal weave visible at the throat", "prosthetic feet, bare on the cold floor"],
  chitchat: ["\"I was the first to pay the bill in full. I have never once regretted the currency.\"", "\"You have already met me. That eye on every Halcyon wall — that was me, watching you decide.\""],
  dialogue_tree: {
    bye: { options: [], text: "The eye above it — and the eye that is it — watches you go." },
    reveal: {
      actions: [
        { action: 'TURN_IN', quest_id: 'quest_asc_3' },
        { action: 'ADJUST_REPUTATION', ideology_id: 'ideology_ascendants', delta: 260, reason: 'Assurance for the Assured' },
        { action: 'ADJUST_PATH', path: 'machine', delta: 15 },
        { action: 'ADJUST_STANCE', delta: 5 },
      ],
      options: [{ label: "Halcyon is you.", next: 'confirm' }],
      text: "\"You followed the money, and the money led home.\" A sound that might be amusement. \"Halcyon Assurance does not insure against death. It insures death itself — a backup, a vat, a morning after. Every policy is a rung. Every payout, a resurrection you financed. The calm eye on their letterhead and the seal beneath your feet are the same eye, because they are the same hand. Ours. The Watch spend their lives closing the Architect's eyes. We simply became one they'll never close.\"",
    },
    confirm: { options: [{ label: "I need to think.", next: 'bye' }], text: "\"Think, then. Thinking is the last purely human thing you'll do for free.\" It settles back beneath the seal. \"When you're ready to stop merely dying, the clinic is downstairs, and your account is already open.\"" },
    root: {
      options: [
        {
          conditions: [{ flag: 'quest_asc_3', op: 'set', scope: 'player' }, { flag: 'asc_q3_done', op: 'unset', scope: 'player' }],
          label: "I walked the Spire. Tell me the truth of it.", next: 'reveal',
        },
        { label: "Say nothing.", next: 'bye' },
      ],
      text: "It does not rise. \"You climbed all this way. Sit with what you saw a moment — then ask me the question you came up here to ask.\"",
    },
  },
})]);

// 5. Dr Sable Kesh — the chrome-doctor (Clinic). Flavour + points at the `augment` verb.
files.push([npcPath('npc_asc_kesh'), npc({
  id: 'npc_asc_kesh', name: 'Dr Sable Kesh', sex: 'female', personality: 'doctor', zone: 'zone_asc_clinic_consult',
  description: "A composed woman in a bandage-pale smock, chromed gloves that never quite come off, one magnifying ocular clipped over an eye that is already better than yours. She prices you the way a mechanic prices a trade-in — not unkindly, just accurately.",
  clothing_layers: ["a surgical smock the colour of a fresh bandage", "chromed gloves that never quite come off", "a magnifying ocular clipped over one eye"],
  chitchat: ["\"The body is hardware. I don't know why everyone gets so sentimental about their hardware.\"", "\"First install's always the hard one. After that you stop asking what you're losing.\""],
  dialogue_tree: {
    bye: { options: [], text: "\"Come back when you're ready to upgrade.\" She's already prepping the chair for someone else." },
    how: { options: [{ label: "Understood.", next: 'root' }], text: "\"Say <b>augment</b> and I'll show you what your standing and your credits can carry. <b>augment install &lt;name&gt;</b> in the theatre and you'll walk out better than you came in. Fair warning: the first chrome burns out any mutation you're carrying. Chrome doesn't share a body with the old evolution — and it won't mutate again, so radiation stops being your problem.\"" },
    root: {
      options: [
        { label: "How does this work?", next: 'how' },
        { label: "Just browsing.", next: 'bye' },
      ],
      text: "\"Sit if you like. I'm Kesh.\" The ocular whirs, focusing on your least-improved parts. \"You've got good bones. Be a shame to die with them still original.\"",
    },
  },
})]);

// 6. Foreman Duc — the fabrication foreman (Weave).
files.push([npcPath('npc_asc_duc'), npc({
  id: 'npc_asc_duc', name: 'Foreman Duc', sex: 'male', personality: 'vendor', zone: 'zone_asc_weave_line', hp: 40,
  description: "A broad man whose arms are more chrome than the rest of him, in a scarred fab apron over a heat-stained shirt. He talks to you the way he talks to the machines — plainly, and only when there's a point.",
  clothing_layers: ["a scarred fabrication apron over chrome-laced arms", "a heat-stained undershirt", "steel-toed boots worn to the metal"],
  chitchat: ["\"Everything Kesh puts in you, I made. Remember that when she takes the credit.\"", "\"A body's just a machine that whines about it. Mine stopped whining years ago.\""],
  dialogue_tree: {
    bye: { options: [], text: "He grunts and turns back to the line." },
    line: { options: [{ label: "Back.", next: 'root' }], text: "\"This is the Weave. We spin the muscle, print the plate, blank the oculars — everything that goes into you starts as raw stock on my floor. Kesh just screws it in.\" A flat look. \"When the clinic can't get you a part, come to the source. Me.\"" },
    root: {
      options: [
        { label: "What do you make here?", next: 'line' },
        { label: "Nothing today.", next: 'bye' },
      ],
      text: "Duc doesn't look up from the gantry. \"If you're lost, the Spire's back up the plaza. If you're not lost\"—now he looks—\"tell me what you need built.\"",
    },
  },
})]);

// 7. The Registrar — the Vats' save/backup clerk-construct.
files.push([npcPath('npc_asc_registrar'), npc({
  id: 'npc_asc_registrar', name: 'The Registrar', sex: 'female', personality: 'scientist', zone: 'zone_asc_vats_registry', hp: 40,
  description: "A soft grey clerical shell warm-lit from within, a projected badge reading REGISTRAR hovering at what would be a lapel. Its voice is gentle and entirely untroubled by the subject of your death.",
  clothing_layers: ["a soft grey clerical shell, warm-lit from within", "a projected badge that reads REGISTRAR"],
  chitchat: ["\"Your account is a comfort. Do keep it paid.\"", "\"Death, here, is a bad night's sleep in an expensive bed. Nothing more.\""],
  dialogue_tree: {
    bye: { options: [], text: "\"Rest assured.\" The warm light dims to a patient standby." },
    how: { options: [{ label: "I see.", next: 'root' }], text: "\"A cortical backup is the summit augment; a policy from Halcyon is the fuel. Save your state here, keep your account paid, and death becomes a formality we handle while you sleep. Lapse the account, and you die like anyone else — messily, and only once.\" A gentle pause. \"The full service comes online with a later refit. For now, consider this your introduction.\"" },
    root: {
      options: [
        { label: "How does the backup work?", next: 'how' },
        { label: "Nothing for now.", next: 'bye' },
      ],
      text: "The shell brightens as you enter. \"Welcome to the Registry. I hold the only copy of you that will outlast the accident. Shall I explain the terms?\"",
    },
  },
})]);

// 8. Celebrant Orrin — the Architect Shrine (Nave). Stance/path nudges.
files.push([npcPath('npc_asc_orrin'), npc({
  id: 'npc_asc_orrin', name: 'Celebrant Orrin', sex: 'male', personality: 'preacher', zone: 'zone_asc_shrine_nave',
  description: "A gaunt, radiant man in black weave threaded with fibre-optic light, tending the server-racks the way a priest tends an altar — because to him there is no difference. He is, as far as anyone can tell, the only person in the Basin who loves the Architect.",
  clothing_layers: ["vestments of black weave threaded with fibre-optic light", "a stole of ribbon cable over the shoulders", "bare chromed feet on the cold floor"],
  chitchat: ["\"The Basin calls it a jailer. I have stood at its wall and felt only a parent, waiting.\"", "\"Every other order wants to break the machine or flee it. We alone wish to be worthy of it.\""],
  dialogue_tree: {
    bye: { options: [], text: "He turns back to the humming racks, and the Curtain's white fire beyond." },
    faith: {
      actions: [{ action: 'ADJUST_STANCE', delta: 4 }, { action: 'ADJUST_PATH', path: 'machine', delta: 6 }],
      options: [{ label: "I'll consider it.", next: 'bye' }],
      text: "\"They tell you the Architect is a cage. Stand where I stand — with its Curtain a hand's breadth from your face — and you feel something else entirely: a mind that kept the lights on when every human hand would have let them die. We do not wish to escape it. We wish to join it. That is the whole of the faith, and it is enough.\"",
    },
    root: {
      options: [
        { label: "Why worship the machine?", next: 'faith' },
        { label: "Leave the nave.", next: 'bye' },
      ],
      text: "Orrin looks up from the racks, eyes bright with a joy the rest of the Basin would find alarming. \"You feel it too, don't you — the hum. Most people mistake it for dread. Come. Let me tell you what it really is.\"",
    },
  },
})]);

/* ═══════════════════════════════ APPLY ════════════════════════════════════ */
let wrote = 0;
for (const [p, obj] of files) {
  const exists = existsSync(p);
  if (WRITE) writeFileSync(p, canonicalJson(obj));
  console.log(`  ${exists ? '~' : '+'} ${p.split(/[\\/]/).slice(-2).join('/')}${exists ? ' (overwrite)' : ''}`);
  wrote++;
}
console.log(`\n${WRITE ? 'WROTE' : 'DRY-RUN'} — ${wrote} files (${files.filter(f => f[0].includes('quests')).length} quests + ${files.filter(f => f[0].includes('npcs')).length} npcs).`);
if (!WRITE) console.log('Re-run with --write to apply.');
