// plugins/consort/index.js
//
// The Echelon's kept companions — Roxy & Bijou — living a life in the owner's
// cabin instead of working a pole. Forked in spirit from the strippers plugin,
// but the money is gone: they're on the payroll, and what makes them undress is
// AROUSAL, and arousal comes from exactly one person.
//
// A consort is any NPC with flags.consort=true and flags.devoted_to=<handle> (the
// one they belong to). Their whole life runs off this 15s tick, which reads the
// live room they're standing in:
//
//   • their keeper is aboard and they're ALONE with them  → arousal climbs; they
//     peel their own layered clothing a piece at a time (MIS-gated narration),
//     murmur devotion, and — with both of them present — run tender two-hander
//     scenes with each other, some of it addressed to him
//   • a stranger is in the cabin                           → the mood dies:
//     arousal cools, they cover back up one layer at a time, and go shy — quiet,
//     guarded, keeping the other one between themselves and the guest
//   • nobody's watching                                    → nothing (no witness)
//
// Nudity and the explicit beats are shown only to players with MIS on, exactly
// like the club; everyone else sees the tamer version of the same moment. The
// `strip` verb (mis plugin) still bares them on command — that's someone ELSE
// removing their clothes and is handled there; this plugin honours _forcedNude
// and leaves a force-stripped consort bare.
//
// All state is in-memory (resets on restart) — a consort's arousal doesn't warrant
// a persisted Flag.

import { schedule } from '../../server/engine/scheduler.js';
import { world, getZone, getZonePlayers, getZoneNpcs, getZoneFurniture, getAllLivePlayers } from '../../server/engine/world.js';
import { sendToZone, sendToPlayer } from '../../server/engine/messaging.js';
import { isMisActive } from '../../server/engine/mis.js';
import { formatChitchat, moveEntity } from '../../server/engine/ai-behaviour.js';
import { on } from '../../server/engine/events.js';
import { exitTargets } from '../../server/engine/exits.js';
import { renderDialogueNode } from '../../server/engine/dialogue.js';
import { query } from '../../server/models/db.js';
import { getItem } from '../../server/engine/items-cache.js';
import { isStackable } from '../../server/engine/tags.js';
import { randomUUID } from 'crypto';

// ── Tunables ────────────────────────────────────────────────────────────────
// Deliberately unhurried: these beats are meant to land rarely and mean something,
// not chatter. The gaps are long and most eligible ticks pass in silence.
const MAX_AROUSAL   = 100;              // fully bare at this
const RISE_PER_TICK  = 12;              // arousal gained per tick while alone with their keeper (slow burn)
const COOL_PER_TICK  = 12;              // arousal shed per tick otherwise
const AROUSED_AT     = 66;              // arousal at/above which solo lines turn hot
const SPEAK_GAP_MS   = 75_000;          // min gap between an NPC's spoken beats
const SPEAK_CHANCE   = 0.33;            // an eligible tick where she just is, quietly
const SCENE_GAP_MS   = 8 * 60_000;      // keep the two-hander a rare treat, not a loop
const SCENE_CHANCE   = 0.3;             // ...and only sometimes when it's eligible
const SCENE_TURN_MS  = [4500, 8000];    // random delay between turns of a scene
const MAX_TURNS      = 6;               // cap however long a chosen thread runs
const FELLATIO_AT    = 84;              // arousal at/above which their signature act can happen
const FELLATIO_CHANCE = 0.5;            // ...and how readily, once peaked (they're experts, not shy)
const FELLATIO_DUO_CHANCE = 0.5;        // when both are here and peaked, chance the scene is a two-girl one

// ── Runtime state (ephemeral) ─────────────────────────────────────────────────
const arousal    = new Map(); // npcId  -> current arousal
const moodCap    = new Map(); // npcId  -> arousal ceiling for the current warming session
const lastSpoke  = new Map(); // npcId  -> ms of last spoken beat (any kind)
const sceneAt    = new Map(); // zoneId -> ms the last two-hander began
const sceneZones = new Set(); // zoneIds with a two-hander currently running

const pick    = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

const isConsort = (npc) => !!npc?.flags?.consort && !npc._dead;
const layersOf  = (npc) => Array.isArray(npc.flags?.clothing_layers) ? npc.flags.clothing_layers : [];

// How many layers should be off at a given arousal — scales with the outfit so a
// two-piece and a three-piece both end fully bare exactly at MAX_AROUSAL.
function peeledForArousal(npc, a) {
  const n = layersOf(npc).length;
  if (!n) return 0;
  if (a >= MAX_AROUSAL) return n;
  return Math.min(n, Math.floor((n * a) / MAX_AROUSAL));
}

// Not every warm evening ends with her clothes on the floor. Each time she starts to
// warm from cold she settles into a mood for that stretch: often she just stays dressed
// and close, sometimes she goes part way, sometimes all the way. The ceiling caps how
// far her arousal — and so her undress — can climb this session.
function rollMoodCap(npc) {
  const r = Math.random();
  if (r < 0.45) {                                   // dressed — warm and devoted, nothing comes off
    const n = layersOf(npc).length || 1;
    return Math.max(0, Math.floor(MAX_AROUSAL / n) - 1);   // just under the first layer peeling
  }
  if (r < 0.72) return randInt(AROUSED_AT, MAX_AROUSAL - 12); // part way — some layers, not bare
  return MAX_AROUSAL;                                          // all the way
}

// Send a room line, explicit version only to MIS-opted-in players (same pattern as
// the strippers plugin's tieredZoneLine).
function tieredZoneLine(zoneId, tame, graphic) {
  for (const p of getZonePlayers(zoneId)) {
    sendToPlayer(p.id, { type: 'zone_event', message: (graphic && isMisActive(p)) ? graphic : tame });
  }
}

// ── Content ───────────────────────────────────────────────────────────────────
// Solo lines are passed through formatChitchat: a fully-"quoted" line renders as a
// yellow say bubble, an unquoted line (no leading name) renders as an emote with
// the name prepended. Devotion/arousal lines are picked tame vs hot by the keeper's
// MIS setting (they only fire when he's alone with them, so the room is just him).
//
// Roxy and Bijou are two different women who made the same cold-eyed bargain and are
// each losing it in their own direction. Their spoken registers live in a per-name
// VOICE table so a devotion line from Bijou reads romantic-and-hungry while Roxy's
// reads composed-and-dry — the same beat, two people. Any other consort (a future
// keeper's) falls back to a neutral DEFAULT voice.
//
//   Roxy  — the strategist. Priced the deal to the credit and took it with open eyes,
//           and cannot forgive herself for having started to actually feel it. Control
//           is her whole currency; the feeling is the one variable she didn't hedge.
//           Dry, competent, the caretaker of the cabin, deflecting with wit.
//   Bijou — the romantic. Chose it just as clearly, played it as a game, and lost the
//           game to her own heart. Wicked and hungry on top, a real fear of being
//           replaced underneath — which is why she can't stop watching the hatch.

const VOICE = {
  roxy: {
    devotedTame: [
      `marks you the second you clear the hatch and goes back to her book, having made her point.`,
      `"There you are. The boat runs better when you're on it. Don't let that go to your head."`,
      `"I had the galley hold dinner. I know how you lose track of time out there." A small shrug, like it cost her nothing.`,
      `pours you two fingers of the good stuff without being asked and sets it exactly where your hand will fall.`,
      `"Sit. You've been vertical since dawn — I can tell from here. Let me have the version of you that isn't working."`,
      `watches you a beat too long, catches herself doing it, and goes coolly back to what she was doing.`,
      `"I chose this, you know. All of it. Some days I even remember it was supposed to be a job." She says it lightly. It doesn't quite land light.`,
    ],
    devotedHot: [
      `sets her drink down with deliberate care and crosses to you like she has all night, because she does.`,
      `"I'm very good at this. You should let me remind you how good." She's not bragging. She's just right.`,
      `takes your jaw in one steady hand and turns your face to the light, appraising, unhurried, in charge of the tempo.`,
      `"The deal was I'd be worth the berth. Come here and let me overdeliver."`,
      `"I don't do this because I have to anymore. That's the part that frightens me." She kisses you before you can answer.`,
    ],
    arousedTame: [
      `"...alright. You've found the crack in me. Congratulations." Her composure is going and she hates and loves it in equal measure.`,
      `presses the back of her hand to her mouth, steadying herself, failing at it.`,
      `"This wasn't in the arrangement. Wanting it this much." She says it like an accusation and leans in anyway.`,
    ],
    arousedHot: [
      `abandons the last of her control all at once and pulls you down with her, done pretending she's above it.`,
      `"Fine. FINE. I need you — is that what you wanted to hear?" She's already climbing into your lap.`,
      `guides your hand exactly where she wants it, precise even now, especially now.`,
    ],
    shy: [
      `gives the guest a cool, unbothered once-over and returns to her book without a word.`,
      `"He didn't mention company." It isn't a question, and she doesn't warm to it.`,
      `pointedly refills only her own glass and lets the silence do the work.`,
      `keeps herself between the stranger and Bijou, calm as a closed door.`,
    ],
    worried: [
      `is across the cabin before you finish the doorway. "Sit down. Now. Let me see it — don't argue with me, just sit."`,
      `has the medkit open on the silk already, hands quick and sure, mouth a hard flat line.`,
      `"You come back to me like this again and I will personally end whoever did it." She's already cleaning the wound.`,
      `presses a cloth to the worst of it, all business, and only her eyes give her away.`,
    ],
    pourTame: [
      (d) => `crosses to the bar and pours you ${d} without being asked, setting it down exactly where your hand will fall.`,
      (d) => `"You didn't have to ask. Knowing what you want before you do is the whole job." She presses ${d} into your hand.`,
      (d) => `pours ${d} with an unhurried, practised economy and slides it to you. "There. Sit down before you fall down."`,
    ],
    pourHot: [
      (d) => `pours ${d} slow, watching you over the rim of the glass, and holds it just out of reach a beat before she lets you take it.`,
      (d) => `brings you ${d}, then leans in close enough that the drink is only half of what's on offer. "Anything else you want poured, be specific."`,
    ],
  },
  bijou: {
    devotedTame: [
      `is off the bed and across the cabin before the hatch finishes opening. "You're BACK. God, finally, it's been an age—"`,
      `"I watched the water all afternoon for the launch. I always spot yours first. Don't tell Roxy I said that."`,
      `winds herself around your arm and doesn't let go. "Stay in tonight. Please. The boat's the wrong shape when you're gone."`,
      `"Tell me you missed me. Even a little. Lie convincingly and I'll believe it on purpose."`,
      `curls into your side like she's trying to occupy the same coordinates as you.`,
      `"I picked this. Eyes open, both of them. Nobody warned me the feelings came free with it." She laughs. It's a little raw.`,
      `keeps one eye on the hatch even now, as if you might be a very convincing dream about to end.`,
    ],
    devotedHot: [
      `slides into your lap uninvited and grins like she owns the deed to it. "There. Now the evening can start."`,
      `"I'm the best decision you ever made and I intend to keep proving it." She's already working your collar loose.`,
      `"Want me. Out loud. I need to hear it more than I need air, which is embarrassing, so — indulge me."`,
      `drags your hand under the satin and holds it there, watching your face like the answer to something lives in it.`,
      `"You could have anyone on this whole boat, this whole city. Pick me. Pick me again." She kisses you before you can, just in case.`,
    ],
    arousedTame: [
      `is undone almost instantly, breath already ragged. "That's not fair, you barely touched me—"`,
      `whimpers and pushes into your hand, past any pretense of patience.`,
      `"I've been like this since I heard the launch. Do something about it. Please, please—"`,
    ],
    arousedHot: [
      `climbs you like the boat's going down and you're the last berth. "Now. I can't — I need it now—"`,
      `"Tell me I'm the one you came home for. Say it while you—" and the rest dissolves into a moan.`,
      `is all appetite and no shame, rolling against you, greedy and certain and terrified you'll stop.`,
    ],
    shy: [
      `goes still and flat-eyed at the stranger, treating them like an unpleasant piece of furniture.`,
      `edges behind Roxy and watches the hatch, willing the right face to appear in it.`,
      `"...you're not supposed to be down here." Barely a whisper, and she won't meet the guest's eye.`,
      `pulls the peignoir tight and makes herself small in the corner of the bed.`,
    ],
    worried: [
      `makes a small wounded sound and is at your side instantly. "No, no, no — who did this, who do I have to hate, sit DOWN—"`,
      `fusses at the wound with shaking hands, near tears. "You can't do this to me. You can't come back broken. I can't—"`,
      `presses herself to your good side, gripping your shirt. "I thought— when the launch was late I thought— don't ever, don't EVER."`,
      `fetches water and cloth at a run and won't stop touching you, checking you're really whole.`,
    ],
    pourTame: [
      (d) => `is up and at the bar before you finish the sentence, pouring ${d}. "For you. Say thank you nicely."`,
      (d) => `presses ${d} into your hand and folds your fingers around the glass, letting hers linger there a moment too long.`,
      (d) => `brings you ${d} in both hands like it's something precious. "Made exactly how you like it. I pay attention."`,
    ],
    pourHot: [
      (d) => `brings you ${d} and steals the first sip from your glass, eyes on you the whole time, before she hands it over.`,
      (d) => `pours ${d} and drapes herself across your lap to deliver it. "Drink. Then I want your undivided attention."`,
    ],
  },
  default: {
    devotedTame: [
      `watches you cross the cabin, everything in her turning to follow.`,
      `arranges herself where the light is kindest and waits for your eyes to find her.`,
      `"You've got that look. The one that means you're staying in tonight." She sounds glad of it.`,
      `"There's nowhere I'd rather be than exactly where you left me."`,
      `reaches out and just rests a hand on you, like she's checking you're real.`,
    ],
    devotedHot: [
      `lets her robe fall open a careless inch and doesn't fix it, watching to see if you noticed.`,
      `"Come here. You don't have to do anything. Just let me be near you."`,
      `draws a slow line down her own throat, eyes on you, patient as the tide.`,
      `"Everything I've got is already yours. I just like reminding you."`,
    ],
    arousedTame: [
      `can't quite hold still now, warm and wanting under your gaze.`,
      `"You're going to make me forget my own name again, aren't you."`,
      `bites her lip and leans into the space between you like gravity.`,
    ],
    arousedHot: [
      `presses herself against you, past shy, all heat and hunger and yours.`,
      `"Please," she breathes, already half undone, "I've been good all day —"`,
      `moves over you slow and shameless, the last of her modesty on the floor with her clothes.`,
    ],
    shy: [
      `draws the throw up over herself and keeps to the far end of the bed, saying nothing.`,
      `pretends to study the wall screen, arms folded, careful not to catch your eye.`,
      `pulls her robe closed at the throat and waits, plainly, for you to leave.`,
      `shifts so the other one is between her and you, and goes quiet.`,
      `gives you a small, distant nod and finds something across the cabin to look at.`,
    ],
    worried: [
      `drops everything and crosses to you. "You're hurt — sit, let me look at you."`,
      `fetches a cloth and presses it to the worst of it, hands careful.`,
      `"Whatever's out there can wait. You come first. Sit still for me."`,
    ],
    pourTame: [
      (d) => `crosses to the bar, pours you ${d}, and sets it in your hand.`,
      (d) => `pours ${d} and offers it up with a warm, easy smile.`,
    ],
    pourHot: [
      (d) => `pours you ${d}, brushing close as she hands it over, in no hurry to step back.`,
    ],
  },
};

// Resolve a consort's spoken register by name (falls back to the neutral default).
function voiceOf(npc) {
  const n = String(npc.name || '').toLowerCase();
  if (n.includes('roxy'))  return VOICE.roxy;
  if (n.includes('bijou')) return VOICE.bijou;
  return VOICE.default;
}

// Peel / redress narration (generic; {g} is the garment). When she does come undone
// for him the hot beats aren't just undressing — she touches herself and reaches for
// you unbidden, no asking required.
const PEEL_HOT = [
  (n, g) => `${n} peels ${g} off slow, watching your face, and lets it drop.`,
  (n, g) => `${n} slips ${g} off and drags her own nails slow up the bared skin, shivering at her own touch.`,
  (n, g) => `${n} works ${g} loose, then takes your hand without a word and presses it to the warm skin beneath.`,
  (n, g) => `${n} lets ${g} fall and leans in to draw your palm down herself, guiding it exactly where she wants it.`,
  (n, g) => `${n} sheds ${g} and cups herself with a soft sound, eyes never once leaving you.`,
  (n, g) => `${n} eases ${g} off an inch at a time, making you watch every second of it.`,
  (n, g) => `${n} lets ${g} slide to the floor and turns a slow circle so you get all of it.`,
  (n, g) => `${n} peels ${g} away and bites her lip, waiting to see what your hands decide to do about it.`,
];
const BARE_HOT = [
  (n) => `${n} is completely bare now, offering the whole of herself with a slow, certain smile.`,
  (n) => `${n} is bare now, hands wandering her own body, watching for the moment they wander to you instead.`,
  (n) => `${n} is down to nothing and pulls you in by the wrist, laying your hands where she wants them.`,
  (n) => `${n} is naked and unhurried, one hand slow on herself and the other already reaching for you, certain of her welcome.`,
  (n) => `${n} is bare and kneeling up on the silk, spine arched, watching you take her in.`,
  (n) => `${n} is naked now and doesn't cover a thing — just lets you look, chin high, pleased with the effect.`,
];
const peelTame    = (n, g) => `${n} slips ${g} off and lets it pool on the silk, eyes on you.`;
const peelHot     = (n, g) => pick(PEEL_HOT)(n, g);
const bareTame    = (n) => `${n} is down to nothing now, unhurried and unashamed in the warm dark.`;
const bareHot     = (n) => pick(BARE_HOT)(n);
const redressTame = (n, g) => `${n} draws ${g} back over herself, the moment folded away.`;
const redressHot  = (n, g) => `${n} slides ${g} back over warm skin, covering up.`;

// ── Fellatio (their signature — worship aimed squarely at the keeper) ────────────
// The one thing they're famous for, and the one thing they take real pride in. This
// only fires in the intimate cabin when the keeper is ALONE with them, MIS is on, he's
// male, and arousal has peaked — a multi-beat scene that plays out turn by turn like
// the two-handers, but MIS-tiered (explicit only to opted-in eyes) and unhurried,
// because expertise is mostly patience. Each turn is [who, tame, hot]; `§` → speaker
// name. Solo threads use only 'A' (one consort); duo threads use 'A' and 'B' (both).
const FELLATIO_SOLO = [
  [
    ['A', `§ sinks to her knees in front of you and looks up, in no hurry at all.`,
          `§ sinks to her knees in front of you, mouth already parting, eyes up and adoring.`],
    ['A', `§ leans in close, breath warm, and takes her time.`,
          `§ takes you in slow and deep, throat opening for it like she's done this a thousand times and loved every one.`],
    ['A', `§ finds a patient rhythm, watching your face for every tell.`,
          `§ hollows her cheeks and works you with her tongue, reading each breath and giving you exactly what it asks for.`],
    ['A', `§ hums low, savouring it, unbothered by time.`,
          `§ takes you to the base and holds you there, throat fluttering, eyes streaming and delighted about it.`],
    ['A', `§ eases back with a soft, satisfied sound and rests her cheek on your thigh.`,
          `§ pulls off slow, kisses the length of you, and murmurs, "You taste like the best part of my whole day."`],
  ],
  [
    ['A', `§ tugs you toward the bed by the waistband, grinning.`,
          `§ frees you from your clothes with practised hands and licks her lips at what she finds.`],
    ['A', `§ starts slow and teasing, all lips and warm breath.`,
          `§ drags her tongue up the underside of you, then swallows you down without warning, eyes locked on yours.`],
    ['A', `§ settles into it, thorough and unhurried.`,
          `§ works you deep and slow, one hand cupping you, the other flat on your hip to feel every twitch.`],
    ['A', `§ looks up at you like there's nowhere else in the world she'd rather be.`,
          `§ moans around you, the sound of it running straight up your spine, and takes you deeper still.`],
  ],
];
const FELLATIO_DUO = [
  [
    ['A', `§ draws you down onto the silk, and Bijou is already there.`,
          `§ draws you down onto the silk and peels you open while Bijou settles in beside her, both grinning.`],
    ['B', `§ presses close on your other side, sharing the space easily.`,
          `§ takes you into her mouth first, slow and deep, while the other watches, waiting her turn.`],
    ['A', `§ leans in to trade places, unhurried and generous.`,
          `§ takes over without missing a beat, the two of them passing you between warm mouths like they've rehearsed it.`],
    ['B', `§ murmurs something to the other and they both laugh softly against you.`,
          `§ and her twin work you together, one deep and one teasing, then swap, tireless and adoring.`],
    ['A', `§ rests her head on your stomach, spent and pleased with the both of them.`,
          `§ kisses her way back up you while Bijou finishes you off, and they share a look that says they'll do it again the second you can.`],
  ],
];

// Play a MIS-tiered multi-turn scene aimed at the keeper. `speakers` maps role
// ('A'/'B') to the consort object for that turn. Re-checks its audience each beat
// and bails if the keeper leaves or a stranger walks in mid-scene.
function playFellatio(zoneId, thread, speakers) {
  sceneZones.add(zoneId);
  let i = 0;
  const cast = Object.values(speakers);
  const step = () => {
    const present = cast.every(n => n && !n._dead && n.zone_id === zoneId);
    if (i >= thread.length || !getZonePlayers(zoneId).length || !present) { sceneZones.delete(zoneId); return; }
    const [who, tame, hot] = thread[i++];
    const speaker = speakers[who] || speakers.A;
    tieredZoneLine(zoneId, tame.replaceAll('§', speaker.name), hot.replaceAll('§', speaker.name));
    const now = Date.now();
    for (const s of cast) { lastSpoke.set(s.id, now); if (s._ai) s._ai.lastSay = now; }
    if (i >= thread.length) { sceneZones.delete(zoneId); return; }
    setTimeout(step, randInt(SCENE_TURN_MS[0], SCENE_TURN_MS[1]));
  };
  step();
}

// ── Two-hander banter (Roxy ⇄ Bijou) ────────────────────────────────────────────
// Each thread is an ordered list of [who, line] turns; who is 'R' (Roxy) or 'B'
// (Bijou), resolved to whichever consort in the room carries that name. Same render
// convention as chitchat. PRIVATE threads play when it's just the two of them (their
// life, each other, the one they're both waiting on); WITH_KEEPER threads play when
// he's in the cabin and they perform their devotion — some of it aimed at him.
const PAIR_PRIVATE = [
  [
    ['B', `"He's not back yet." She says it to the porthole, not to Roxy.`],
    ['R', `"He's back when he's back. Sit down, Bijou — you'll wear a track in the carpet."`],
    ['B', `"You watch that door same as me. Don't pretend you don't."`],
    ['R', `a small, caught smile. "...I watch it a little."`],
  ],
  [
    ['R', `stretches out along the silk and sighs. "Do you ever think about before? Before the boat?"`],
    ['B', `"Every day. Then I look around at all this and I stop thinking about it."`],
    ['R', `"That's the trick of it, isn't it. He makes the before very easy to forget."`],
  ],
  [
    ['B', `"Brush my hair? I can never reach the back the way you do."`],
    ['R', `settles behind her and works the tangles out slow. "Hold still. You're always squirming."`],
    ['B', `"It's nice. Nobody did this, before you."`],
  ],
  [
    ['R', `"You took the last of the good wine again."`],
    ['B', `grins, unrepentant. "I left you the bottle he likes. That's practically a love letter."`],
  ],
  [
    ['B', `"If it were only ever the two of us out here — would that be so bad?"`],
    ['R', `quiet a moment. "It's never only the two of us. But I know what you mean."`],
  ],
  [
    ['R', `"You're humming that song again."`],
    ['B', `"It's stuck. It's been stuck since the harbour." She hums it anyway, softer.`],
  ],
  [
    ['B', `paints a second coat on her toes and holds a foot out. "Honest opinion. Too much?"`],
    ['R', `considers it like it's a matter of state. "For anyone else, yes. For you, exactly enough."`],
    ['B', `wiggles the toes, satisfied. "That's why I ask you and not the mirror."`],
  ],
  [
    ['R', `"Do you think he'd notice if we rearranged the whole cabin while he's out?"`],
    ['B', `"He notices when you move one cushion. He won't say anything. He'll just... look at it."`],
    ['R', `laughs. "The look. God, the look. Fine, the cushion stays."`],
  ],
  [
    ['B', `curls up small on the chaise. "What do you think we'd be, if none of this had happened?"`],
    ['R', `quiet a while. "Cold, probably. Hungry. Somewhere with worse light." She tucks the throw round them both. "Don't do that to yourself."`],
  ],
  [
    ['R', `"You fell asleep mid-sentence last night. Again."`],
    ['B', `unbothered. "I was comfortable. That's a compliment to the company." She stretches. "What was I saying?"`],
    ['R', `"No idea. Something about the stars. You were very moved about it."`],
  ],
];
const PAIR_WITH_KEEPER = [
  [
    ['B', `sits up the instant the hatch opens. "There he is. Roxy — he's home."`],
    ['R', `already crossing the cabin. "We kept it warm for you. We always keep it warm."`],
  ],
  [
    ['B', `"He looked at you first this time. I'm keeping score, you know."`],
    ['R', `"You keep a terrible score. He looked at the door — I was just standing in front of it."`],
    ['B', `laughs. "Same thing, on this boat."`],
  ],
  [
    ['R', `"Can we get you anything? You only have to say it. You barely have to say it."`],
    ['B', `"She means she'll fetch it. I'll supervise. It's a whole system."`],
  ],
  [
    ['B', `curls a little closer, eyes on him. "Stay in tonight. Let the sea handle the rest of them."`],
    ['R', `"She's right. There's nothing out there we can't be for you in here."`],
  ],
  [
    ['R', `"Tell us where you sailed today. Bijou pretends she doesn't listen, but she memorises every word."`],
    ['B', `doesn't look up from the porthole. "I do not." A beat. "...it was the northern channel, though, wasn't it."`],
  ],
  [
    ['B', `"We had an argument today about which of us you like best."`],
    ['R', `"There was no argument. I won." A pause. "...it was a draw. We're calling it a draw."`],
    ['B', `"We're asking you to settle it. Carefully. Whole evenings ride on this."`],
  ],
  [
    ['R', `"He's got that crease between his eyebrows again, Bijou."`],
    ['B', `already moving. "I see it. I've got the shoulders, you've got the rest. Come here, you — sit."`],
  ],
  [
    ['B', `"Roxy learned your coffee. The real way, not the way the galley does it."`],
    ['R', `"It took me a week and I will not be humble about it. Sit. Let me ruin every other cup you'll ever have."`],
  ],
];

// ── Talk (npc.talk hook — warm to the keeper, shy to everyone else) ─────────────
const TALK_TO_KEEPER = [
  `"You don't have to talk to me like a guest. It's just me. I'm always just here, for you."`,
  `ducks her head with a small, private smile. "Hello, you. I was hoping you'd come find me."`,
  `"Sit with me? You've been running this whole city. Let me have you a while."`,
  `"Anything you want to tell me, I'll keep. Anything you want to forget, I'll help with that too."`,
  `leans into you like a cat finding sun. "Mm. I missed you. The boat's too quiet without you in it."`,
  `"I made a list of things I like about you today. It got long. I had to stop or I'd never finish."`,
  `catches your hand and turns it over, tracing the lines of your palm. "You've got good hands. I think about them."`,
  `"Tell me about your day. All of it. I want the boring parts too — they're yours, so they're mine."`,
  `"You could put me anywhere on this boat and I'd still drift back to whatever room you're in."`,
  `"Was it a hard day? Come here. Let me be the easy part."`,
];
const TALK_SHY = [
  `barely looks up, drawing the robe a little tighter. "...I don't really talk to guests. Sorry."`,
  `gives you a polite, distant smile and looks away. "You should ask whoever brought you aboard."`,
  `"Oh — no, I. I'm not part of the tour." She edges toward the far side of the cabin.`,
  `answers so softly you almost miss it. "I'm sure you're very nice. I'd just rather you sat over there."`,
  `"He didn't say anyone was coming down here." Her eyes flick to the hatch, hoping.`,
  `keeps her eyes down and her answers to one word. "...Fine. Thanks." She doesn't ask you anything back.`,
  `"I think there's been a mix-up. This part of the boat isn't really for guests." She waits for you to take the hint.`,
  `folds her arms and studies the floor. "I'd rather wait for him, if it's all the same to you."`,
];

// ── Two-hander playback ─────────────────────────────────────────────────────────
// Resolve 'R'/'B' to the named consorts in the room; play turn by turn, re-checking
// both are still present and someone's still watching before every line.
function playScene(zoneId, roxy, bijou, thread) {
  sceneZones.add(zoneId);
  let i = 0;
  const step = () => {
    const bothHere = roxy && bijou && !roxy._dead && !bijou._dead
      && roxy.zone_id === zoneId && bijou.zone_id === zoneId;
    if (i >= thread.length || !bothHere || !getZonePlayers(zoneId).length) {
      sceneZones.delete(zoneId);
      return;
    }
    const [who, line] = thread[i++];
    const speaker = who === 'B' ? bijou : roxy;
    sendToZone(zoneId, formatChitchat(speaker.name, line));
    const now = Date.now();
    lastSpoke.set(roxy.id, now);
    lastSpoke.set(bijou.id, now);
    if (speaker._ai) speaker._ai.lastSay = now;
    if (i >= thread.length) { sceneZones.delete(zoneId); return; }
    setTimeout(step, randInt(SCENE_TURN_MS[0], SCENE_TURN_MS[1]));
  };
  step();
}

const findConsort = (npcs, name) => npcs.find(n => String(n.name || '').toLowerCase().includes(name));

// ── Area life (beckoned out of the cabin) ───────────────────────────────────────
// The suite and the boudoir are their INTIMATE spaces — arousal, undress, devotion
// (the block in the tick below). Beckoned anywhere else aboard, they instead live a
// life keyed to the deck they're standing on: they pick an activity, stay in it for
// a good while, and only occasionally change or comment. Nothing here is hardcoded
// to a content id — the area is read off zone flags.
const isIntimateZone = (zone) => !!zone?.flags?.echelon_suite;   // suite + boudoir

function areaProfile(zone) {
  const f = zone?.flags || {};
  if (f.echelon_sundeck) return 'sundeck';
  if (f.echelon_helipad) return 'helipad';
  if (f.echelon_view)    return 'view';        // stern lounge, stair landing
  return 'cabin';                              // foyer, bridge, anywhere else aboard
}

// Activity tunables — deliberately slow. She settles into a thing for minutes, and
// most eligible ticks pass with nothing said.
const ACT_MIN_MS       = 210_000;   // ~3.5 min settled into an activity...
const ACT_MAX_MS       = 480_000;   // ...up to ~8
const ACT_SPEAK_GAP_MS = 90_000;    // and a long gap between any continuation beats
const ACT_IDLE_CHANCE  = 0.15;      // most eligible ticks she simply is

// Line factory: `§` is replaced with her name. Second arg is the MIS-only (skin)
// variant, shown only to opted-in viewers and only when she's alone with her keeper.
const L = (t, h) => ({ t: (n) => t.replaceAll('§', n), h: h ? (n) => h.replaceAll('§', n) : null });

const AREA_ACTIVITIES = {
  sundeck: [
    { key: 'suntan', occupies: 'sun loungers',
      start: L('§ stretches out along a lounger and tips her face up to the sun.',
               '§ shrugs out of her robe to a scrap of bikini and stretches out to tan, warm and unbothered.'),
      idle: [ L('§ turns over to catch the sun on her back, unhurried.'),
              L('§ reaches lazily for the sunscreen and, after a slow appraisal of who’s watching, decides you can do her back.',
                '§ presses the sunscreen into your hand, rolls onto her front, and unties the bikini at her back without comment.'),
              L('§ hums behind big dark glasses, one knee lazily up.',
                '§ tugs a bikini strap off her shoulder for an even tan, and then the other, just to see if you’ll say anything.'),
              L('§ arches in a long, luxurious stretch on the lounger and pretends she didn’t.',
                '§ arches off the lounger in a long stretch, bare and gilded with sun oil, and holds it a beat too long for it to be an accident.') ] },
    { key: 'jacuzzi', occupies: 'jacuzzi', minMs: 240_000, maxMs: 600_000,
      start: L('§ slips into the jacuzzi with a long, contented sigh, water up to her collarbone.',
               '§ peels down and sinks into the jacuzzi bare, water sliding over warm skin, and moans softly at the heat.'),
      idle: [ L('§ tips her head back against the jacuzzi’s edge, eyes closed, jets purring.'),
              L('§ trails a slow hand through the steaming water, in no hurry to get out.',
                '§ drifts to your side of the jacuzzi through the steam and settles a bare thigh over yours under the water.'),
              L('§ sinks lower until the water kisses her chin, blissed-out.',
                '§ rises to rest bare and glistening on the tiled edge a moment, thighs parted to the jets, then sinks back under with a wicked little smile.'),
              L('§ nudges a jet with her hip, decides she approves of it, and stays exactly there.',
                '§ shifts onto a jet with a slow shudder, bites her lip, and murmurs that the Echelon really does think of everything.') ] },
    { key: 'cocktail',
      start: L('§ plucks a frosted glass off the tray and sips, watching the water.'),
      idle: [ L('§ rolls the cold glass against her cheek and sighs at the sun.'),
              L('§ fishes the cherry out with two fingers and eats it while holding your eye, entirely on purpose.'),
              L('§ swirls the ice and steals a look your way over the rim.') ] },
    { key: 'dip', occupies: 'jacuzzi',
      start: L('§ perches on the jacuzzi’s tiled lip and trails her toes through the warm spill.'),
      idle: [ L('§ kicks a lazy arc of water into the light and laughs at nothing.'),
              L('§ dangles both legs into the froth and leans back on her hands, sun on her throat.',
                '§ dangles both legs into the froth, leans back bare to the sun, and asks — perfectly innocent — whether you’re coming in.') ] },
    { key: 'read', occupies: 'sun loungers',
      start: L('§ curls into a lounger with a glossy magazine, one knee up.'),
      idle: [ L('§ turns a page without really reading it, sun-drunk.'),
              L('§ holds the magazine up like a fig leaf, peeks over the top at you, and grins.',
                '§ lets the magazine slide off her bare stomach, gives up the pretence entirely, and just watches you.') ] },
    { key: 'nap', occupies: 'sun loungers',
      start: L('§ pulls a wide sunhat down over her eyes and dozes on the lounger, breathing slow.'),
      idle: [ L('§ stirs, murmurs something, and settles deeper into the cushions.',
                '§ shifts in her half-sleep, one bare leg sliding off the lounger, utterly unbothered by where the robe’s gone.') ] },
  ],
  view: [
    { key: 'recline',
      start: L('§ folds herself into the leather and watches the black water slide past.'),
      idle: [ L('§ draws her knees up, rests her chin on them, and goes quiet.'),
              L('§ traces a fingertip down the cold glass, following some far light on the water.'),
              L('§ sighs, content, and sinks a little deeper into the leather.') ] },
    { key: 'rail',
      start: L('§ leans on the rail, chin on her hands, following a wake that isn’t there.'),
      idle: [ L('§ lets the Basin wind take her hair and doesn’t fix it.'),
              L('§ points at nothing on the horizon and smiles to herself.') ] },
    { key: 'sip',
      start: L('§ warms her hands around a glass and says nothing, content.'),
      idle: [ L('§ tips the last of the glass back and watches the horizon smudge grey.'),
              L('§ swirls the ice slow, in no hurry to refill it.') ] },
    { key: 'throw',
      start: L('§ pulls a cashmere throw around her shoulders against the Basin chill.'),
      idle: [ L('§ burrows a little further into the throw, cosy.'),
              L('§ tucks her toes up under the throw and hums something low.') ] },
    { key: 'people-watch',
      start: L('§ curls sideways in the lounge and watches the far shore lights come on one by one.'),
      idle: [ L('§ picks out a window across the water and invents a whole life for whoever’s in it.') ] },
  ],
  helipad: [
    { key: 'windswept',
      start: L('§ laughs as the open wind whips her hair across her face.'),
      idle: [ L('§ spreads her arms to the wind and lets the whole sky have her.'),
              L('§ tips her head back and just breathes the cold open air.') ] },
    { key: 'edge',
      start: L('§ drifts to the rail and looks out over the long drop to the Basin.'),
      idle: [ L('§ leans into the wind, fearless, grinning at the dark water.'),
              L('§ toes right up to the line and dares the height to bother her. It doesn’t.') ] },
    { key: 'huddle',
      start: L('§ hugs herself against the rotor-cold up here and grins through it.'),
      idle: [ L('§ bounces on her toes to keep warm, breath clouding.'),
              L('§ pulls her sleeves over her hands and stamps in a little circle.') ] },
    { key: 'skyline',
      start: L('§ shades her eyes and picks the towers out of the haze one by one.'),
      idle: [ L('§ names a district under her breath, then decides she likes the view better than the city.') ] },
  ],
  cabin: [
    { key: 'linger',
      start: L('§ drapes herself over the nearest rail and watches you move through the room.'),
      idle: [ L('§ shifts her weight, unhurried, following you with her eyes.'),
              L('§ tips her head, tracking you across the cabin like you’re the only thing worth watching.') ] },
    { key: 'admire',
      start: L('§ trails a fingertip along the brushed titanium and takes it all in.'),
      idle: [ L('§ tilts her head at her own reflection in the bulkhead and half-smiles.'),
              L('§ tests the weight of some expensive little thing, sets it down exactly where it was.') ] },
    { key: 'perch',
      start: L('§ perches on the edge of something expensive and crosses her legs.'),
      idle: [ L('§ swings a foot idly and waits, content just to be near you.'),
              L('§ props her chin on one hand and watches you like she’s got all the time in the world.') ] },
    { key: 'tidy',
      start: L('§ drifts around the cabin straightening things that were already straight.'),
      idle: [ L('§ plumps a cushion, steps back to judge it, and moves on satisfied.') ] },
  ],
};

// Deck two-handers — Roxy⇄Bijou banter keyed to where they're beckoned, played the
// same way as the cabin scenes but out in the open (tame; the public deck isn't the
// place they come undone). Rare and long-gapped like every other beat.
const AREA_BANTER = {
  sundeck: [
    [
      ['B', `sinks into the jacuzzi opposite Roxy. "He built a boat with a hot tub on the roof. For us. Do you ever just... stop and think about that?"`],
      ['R', `"I try not to. If I think about it too hard I start crying into very expensive water."`],
    ],
    [
      ['R', `flicks a little water at Bijou across the froth. "You're hogging the good jet again."`],
      ['B', `"I found it first. Possession is nine tenths." She does not move. "You can share it. If you're nice."`],
      ['R', `raises an eyebrow, and slides over. "...I can be nice."`],
    ],
    [
      ['B', `oils her shoulders on the lounger and holds the bottle out. "Do my back? Roxy always misses a bit on purpose."`],
      ['R', `"I do not." A beat. "I miss it so he has to finish the job. That's strategy, not laziness."`],
      ['B', `laughs. "See, this is exactly why he keeps us both."`],
    ],
    [
      ['R', `stretches out gold with sun oil and sighs. "If the harbour could see us now."`],
      ['B', `"The harbour can see us now. That's a camera drone." She waves at it, lazy and unbothered.`],
    ],
  ],
  view: [
    [
      ['B', `"I could watch this water all night."`],
      ['R', `settles in beside her. "You say that, and then you're asleep on my shoulder in twenty minutes."`],
      ['B', `"...and you let me. Every time."`],
    ],
    [
      ['R', `"Name that constellation."`],
      ['B', `squints. "That one's 'The Big Expensive Boat.' And that one's 'The Two Girls Who Live On It.'"`],
      ['R', `"...I can't fault your astronomy."`],
    ],
  ],
  helipad: [
    [
      ['B', `throws her arms wide into the wind. "I'm the queen of the entire sky, Roxy!"`],
      ['R', `hangs back by the rail, laughing. "You're going to be the queen of the entire Basin if you lean any further."`],
      ['B', `"You'd catch me."`],
      ['R', `"...I'd catch you."`],
    ],
  ],
  cabin: [
    [
      ['B', `"Bet you can't guess which room he's in without looking."`],
      ['R', `doesn't hesitate. "Bridge. He's always the bridge before dinner." A beat. "Am I right?"`],
      ['B', `grins. "You're always right. It's insufferable."`],
    ],
  ],
};

// One consort's turn of area-life. Picks/holds an activity keyed to the deck, and
// only rarely narrates. Hot (skin) lines play only when she's alone with her keeper.
function runAreaActivity(npc, zone, zoneId, now, keeperHere, strangerHere) {
  const profile = areaProfile(zone);
  const acts = AREA_ACTIVITIES[profile] || AREA_ACTIVITIES.cabin;

  // Out here she's presentable: shed any cabin arousal/undress so she never wanders
  // onto the sun deck mid-strip.
  if ((npc._clothingPeeled || 0) && !npc._forcedNude) npc._clothingPeeled = 0;
  arousal.set(npc.id, 0);
  moodCap.delete(npc.id);   // next time she's back in the cabin she rolls a fresh mood

  const graphicOK = keeperHere && !strangerHere;   // she only bares for him
  const cur = npc._activity;
  const stale = !cur || cur.profile !== profile || now >= (npc._activityUntil || 0);

  if (stale) {
    const choices = acts.filter(a => !cur || a.key !== cur.key);   // avoid immediate repeat
    const act = pick(choices.length ? choices : acts);
    npc._activity = { key: act.key, profile };
    npc._activityUntil = now + randInt(act.minMs || ACT_MIN_MS, act.maxMs || ACT_MAX_MS);
    npc.onFurniture = act.occupies || null;   // parks her on the jacuzzi/loungers so the room shows it
    tieredZoneLine(zoneId, act.start.t(npc.name), graphicOK ? act.start.h?.(npc.name) : null);
    lastSpoke.set(npc.id, now);
    return;
  }

  // Mid-activity: an occasional, unhurried continuation beat.
  if (now - (lastSpoke.get(npc.id) || 0) < ACT_SPEAK_GAP_MS) return;
  if (Math.random() > ACT_IDLE_CHANCE) return;
  const act = acts.find(a => a.key === cur.key);
  if (!act) return;
  const line = pick(act.idle);
  tieredZoneLine(zoneId, line.t(npc.name), graphicOK ? line.h?.(npc.name) : null);
  lastSpoke.set(npc.id, now);
}

// ── Tick ────────────────────────────────────────────────────────────────────
let ticking = false;
function consortTick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const [zoneId, zone] of world.zones) {
      if (!zone.players || zone.players.size === 0) continue;   // no witness → no life
      const players = getZonePlayers(zoneId);
      const consorts = getZoneNpcs(zoneId).filter(isConsort);
      if (!consorts.length) continue;

      // A two-hander is a room-level event; try it once, before the per-NPC beats,
      // and only when the room is private (no stranger to be shy in front of).
      const anyStranger = (devoted) => players.some(p => p.handle !== devoted);

      // Deck banter: out on the ship (not the intimate cabins), the two of them
      // occasionally run a scene keyed to the deck they're on. Rare and long-gapped.
      if (!isIntimateZone(zone) && !sceneZones.has(zoneId)
          && now - (sceneAt.get(zoneId) || 0) > SCENE_GAP_MS
          && Math.random() < SCENE_CHANCE) {
        const roxy = findConsort(consorts, 'roxy');
        const bijou = findConsort(consorts, 'bijou');
        const pool = AREA_BANTER[areaProfile(zone)];
        if (roxy && bijou && roxy !== bijou && pool?.length
            && !roxy._combatTargetId && !bijou._combatTargetId
            && roxy.zone_id === zoneId && bijou.zone_id === zoneId) {
          sceneAt.set(zoneId, now);
          playScene(zoneId, roxy, bijou, pick(pool));
          continue;                                              // the banter owns the room this tick
        }
      }

      for (const npc of consorts) {
        if (npc._combatTargetId || npc.posture === 'lying') continue;
        const devoted     = npc.flags?.devoted_to;
        const keeperHere  = !!devoted && players.some(p => p.handle === devoted);
        const strangerHere = anyStranger(devoted);
        const keeper      = keeperHere ? players.find(p => p.handle === devoted) : null;

        // Beckoned out onto the ship (anywhere but the intimate cabins), she lives a
        // life keyed to that deck instead of the arousal/undress path.
        if (!isIntimateZone(zone)) {
          runAreaActivity(npc, zone, zoneId, now, keeperHere, strangerHere);
          continue;
        }
        npc.onFurniture = null;   // back in the cabins she's on the arousal/undress path, not parked on deck furniture

        // Reactive care: if he's come back to her badly hurt, the seduction stops.
        // The relationship isn't only the bedroom — arousal cools, anything already
        // peeled goes back on, and, alone with him, she tends him instead. Read off
        // the live keeper object (no DB); more signals (drunk/wanted) can hook in here.
        const keeperHurt = keeper && keeper.hp_max > 0 && (keeper.hp || 0) / keeper.hp_max < 0.5;
        if (keeperHurt && keeperHere && !strangerHere) {
          arousal.set(npc.id, Math.max(0, (arousal.get(npc.id) || 0) - COOL_PER_TICK));
          moodCap.delete(npc.id);
          const layers = layersOf(npc);
          if ((npc._clothingPeeled || 0) > 0 && !npc._forcedNude) {   // cover back up, one layer/tick
            const g = layers[npc._clothingPeeled - 1];
            npc._clothingPeeled -= 1;
            tieredZoneLine(zoneId, redressTame(npc.name, g), redressHot(npc.name, g));
            lastSpoke.set(npc.id, now);
            continue;
          }
          if (now - (lastSpoke.get(npc.id) || 0) >= SPEAK_GAP_MS && Math.random() < SPEAK_CHANCE) {
            sendToZone(zoneId, formatChitchat(npc.name, pick(voiceOf(npc).worried)));
            lastSpoke.set(npc.id, now);
          }
          continue;                                                   // no arousal/undress while he's hurt
        }

        // Arousal only ever climbs when they're ALONE with the one they belong to.
        // A stranger in the room — even with him present — kills it. How far it climbs
        // this session is capped by the mood she rolled when she first warmed up, so
        // she doesn't strip every single time.
        const warming = keeperHere && !strangerHere;
        let a = arousal.get(npc.id) || 0;
        if (warming) {
          if (a === 0 && !moodCap.has(npc.id)) moodCap.set(npc.id, rollMoodCap(npc));
          a = Math.min(moodCap.has(npc.id) ? moodCap.get(npc.id) : MAX_AROUSAL, a + RISE_PER_TICK);
        } else {
          a = Math.max(0, a - COOL_PER_TICK);
          if (a === 0) moodCap.delete(npc.id);   // cooled all the way → fresh mood next time she warms
        }
        arousal.set(npc.id, a);

        // Undress / cover up. A force-stripped consort (the `strip` verb) is held
        // bare and skips this — someone else took her clothes; she doesn't put them
        // back until that's cleared.
        const layers = layersOf(npc);
        const before = npc._clothingPeeled || 0;
        if (npc._forcedNude) {
          npc._clothingPeeled = layers.length;
        } else {
          const after = peeledForArousal(npc, a);
          if (after > before && layers.length) {
            for (let i = before; i < after && i < layers.length; i++) {
              tieredZoneLine(zoneId, peelTame(npc.name, layers[i]), peelHot(npc.name, layers[i]));
            }
            npc._clothingPeeled = after;
            if (after >= layers.length) tieredZoneLine(zoneId, bareTame(npc.name), bareHot(npc.name));
            lastSpoke.set(npc.id, now);
            continue;                                            // the undress is her beat this tick
          }
          if (after < before && layers.length) {
            const g = layers[before - 1];                        // innermost-off goes back on first
            npc._clothingPeeled = before - 1;
            tieredZoneLine(zoneId, redressTame(npc.name, g), redressHot(npc.name, g));
            lastSpoke.set(npc.id, now);
            continue;                                            // the cover-up is her beat this tick
          }
        }

        // Signature act — their expertise. Peaked, alone with him, MIS on, and he's
        // male: they go down on him. A multi-beat, MIS-tiered scene on the same long
        // cooldown as the two-handers, sometimes solo, sometimes both of them at once.
        if (keeperHere && !strangerHere && a >= FELLATIO_AT
            && keeper?.biological_sex === 'male' && isMisActive(keeper)
            && !sceneZones.has(zoneId)
            && now - (sceneAt.get(zoneId) || 0) > SCENE_GAP_MS
            && Math.random() < FELLATIO_CHANCE) {
          sceneAt.set(zoneId, now);
          const roxy = findConsort(consorts, 'roxy');
          const bijou = findConsort(consorts, 'bijou');
          const bothHere = roxy && bijou && roxy !== bijou
            && roxy.zone_id === zoneId && bijou.zone_id === zoneId;
          if (bothHere && Math.random() < FELLATIO_DUO_CHANCE) {
            playFellatio(zoneId, pick(FELLATIO_DUO), { A: roxy, B: bijou });
          } else {
            playFellatio(zoneId, pick(FELLATIO_SOLO), { A: npc });
          }
          break;                                                 // the scene owns the room this tick
        }

        // Spoken beats — throttled, and sometimes she just is, quietly.
        if (now - (lastSpoke.get(npc.id) || 0) < SPEAK_GAP_MS) continue;

        // Two-hander: private only, both of them here, on a long cooldown.
        if (!strangerHere && !sceneZones.has(zoneId)
            && now - (sceneAt.get(zoneId) || 0) > SCENE_GAP_MS
            && Math.random() < SCENE_CHANCE) {
          const roxy = findConsort(consorts, 'roxy');
          const bijou = findConsort(consorts, 'bijou');
          if (roxy && bijou && roxy !== bijou) {
            sceneAt.set(zoneId, now);
            playScene(zoneId, roxy, bijou, pick(keeperHere ? PAIR_WITH_KEEPER : PAIR_PRIVATE));
            break;                                               // the scene owns the room this tick
          }
        }

        if (Math.random() > SPEAK_CHANCE) continue;

        // Solo beat: shy to a stranger; devoted (tier by arousal) to the keeper alone.
        // Each consort speaks in her own register (voiceOf).
        const V = voiceOf(npc);
        if (strangerHere) {
          sendToZone(zoneId, formatChitchat(npc.name, pick(V.shy)));
          lastSpoke.set(npc.id, now);
        } else if (keeperHere) {
          const hot = isMisActive(keeper);
          const pool = a >= AROUSED_AT ? (hot ? V.arousedHot : V.arousedTame)
                                       : (hot ? V.devotedHot : V.devotedTame);
          sendToZone(zoneId, formatChitchat(npc.name, pick(pool)));
          lastSpoke.set(npc.id, now);
        }
      }
    }
  } finally {
    ticking = false;
  }
}

schedule('15s', consortTick);

// ── Talk hook ─────────────────────────────────────────────────────────────────
// Claim `talk <consort>`. For the one they belong to this OPENS A REAL CONVERSATION:
// if the NPC carries a dialogue_tree we render its root through the shared engine
// renderer (so option-clicks follow the normal dialogue path and flag-gated depth
// tiers work) — that's where the get-to-know-them writing lives. Without a tree we
// fall back to a warm one-liner. A stranger only ever gets a shy deflection; their
// conversation stays closed. Returning undefined falls through to normal dialogue.
async function onTalk({ player, npc, broadcast }) {
  if (!player || !isConsort(npc)) return undefined;
  const devoted = npc.flags?.devoted_to;
  const isKeeper = devoted && player.handle === devoted;

  if (isKeeper && npc.dialogue_tree?.root) {
    const rendered = await renderDialogueNode(npc, 'root', player, { broadcast, npc });
    if (rendered) {
      return { type: 'dialogue', npcId: npc.id, npcName: npc.name, node: 'root', text: rendered.text, options: rendered.options };
    }
  }

  const line = isKeeper ? pick(TALK_TO_KEEPER) : pick(TALK_SHY);
  return formatChitchat(npc.name, line);
}

// ── Beckon / dismiss (keeper-only) ──────────────────────────────────────────────
// The consorts live tucked away in a concealed boudoir off the suite (their
// home_zone) and only step out when their keeper calls. Their emergence zone is
// whatever room that boudoir's `out` door opens onto — the suite — so nothing is
// hardcoded to a content id here.
const NOOP = () => {};

const consortsOf = (handle) =>
  handle ? [...world.npcs.values()].filter(n => isConsort(n) && n.flags?.devoted_to === handle) : [];

// The room a consort emerges into: the zone their home boudoir exits to.
function emergeZoneOf(npc) {
  const home = getZone(npc.home_zone);
  return home ? (exitTargets(home, 'out')[0] || null) : null;
}

// Narrate a consort beat to the room, MIS-tiered per viewer, but skip the keeper —
// their own view is returned to them as the command result instead (no duplicate).
function narrateToRoom(zoneId, keeperId, tame, hot) {
  for (const p of getZonePlayers(zoneId)) {
    if (p.id === keeperId) continue;
    // refresh so the top pane re-looks and lists her now that she's in the room.
    sendToPlayer(p.id, { type: 'zone_event', message: (hot && isMisActive(p)) ? hot : tame, refresh: true });
  }
}

// Arrival / departure narration. From the suite she comes through the concealed
// wardrobe; called out to any other deck she simply makes her way up to him.
const arriveLines = (n, viaWardrobe) => viaWardrobe
  ? [`The mirrored wardrobe swings inward and ${n} steps out, finding you at once.`,
     `The mirrored wardrobe swings inward and ${n} slips out, all warm silk and welcome, her eyes going straight to you.`]
  : [`${n} makes her way to you and settles in close.`,
     `${n} makes her way to you, robe loose and eyes bright, and settles in close.`];
const departLines = (n, viaWardrobe) => viaWardrobe
  ? [`${n} slips back through the mirrored wardrobe and is gone.`,
     `${n} presses a kiss to the air and slips back through the mirrored wardrobe, out of sight.`]
  : [`${n} gathers herself and heads back below to the boudoir.`,
     `${n} blows you a kiss and slips away below.`];

async function cmdBeckon(args, raw, player) {
  const mine = consortsOf(player.handle);
  if (!mine.length) return { type: 'error', message: 'No one here answers to you like that.' };

  const here = getZone(player.current_zone);
  if (!here?.flags?.echelon) return { type: 'error', message: "They won't leave the Echelon. Call for them from aboard." };
  const home = mine[0].home_zone;
  if (player.current_zone === home) return { type: 'error', message: "You're already in the boudoir with them." };

  const name = args.join(' ').trim().toLowerCase();
  let targets = mine;
  if (name) {
    targets = mine.filter(n => String(n.name || '').toLowerCase().includes(name));
    if (!targets.length) return { type: 'error', message: 'No one of yours by that name.' };
  }

  const dest = player.current_zone;
  const viaWardrobe = dest === emergeZoneOf(mine[0]);   // the suite the boudoir opens onto
  const lines = [];
  for (const npc of targets) {
    if (npc._dead || npc.zone_id === dest) continue;               // dead or already here
    npc._activity = null; npc._activityUntil = 0;                  // fresh read of the new area
    npc.onFurniture = null;                                        // not parked on anything until she settles
    const [tame, hot] = arriveLines(npc.name, viaWardrobe);
    narrateToRoom(dest, player.id, tame, hot);
    moveEntity(npc, dest, NOOP, query);                            // silent hop; we narrate it
    lines.push(isMisActive(player) ? hot : tame);
  }
  if (!lines.length) return { type: 'output', message: 'They’re already here with you.' };
  // Refresh the keeper's own top pane too, so the room lists her the moment she arrives.
  sendToPlayer(player.id, { type: 'zone_event', refresh: true });
  return { type: 'output', message: lines.join('\n') };
}

// Send some/all of a keeper's out-of-boudoir consorts back to their hidden room.
// Narrates to the room they leave (all viewers); returns the ones actually sent.
function retreatConsorts(list, filterName) {
  const sent = [];
  for (const npc of list) {
    if (npc._dead || npc.zone_id === npc.home_zone) continue;      // already tucked away
    if (filterName && !String(npc.name || '').toLowerCase().includes(filterName)) continue;
    const [tame, hot] = departLines(npc.name, npc.zone_id === emergeZoneOf(npc));
    tieredZoneLine(npc.zone_id, tame, hot);
    npc._activity = null; npc._activityUntil = 0; npc.onFurniture = null;
    moveEntity(npc, npc.home_zone, NOOP, query);
    sent.push(npc);
  }
  return sent;
}

async function cmdDismiss(args, raw, player) {
  const mine = consortsOf(player.handle);
  if (!mine.length) return { type: 'error', message: 'No one here answers to you like that.' };
  const sent = retreatConsorts(mine, args.join(' ').trim().toLowerCase() || null);
  if (!sent.length) return { type: 'output', message: 'They’re already tucked away.' };
  return { type: 'output', message: `You send ${sent.map(n => n.name).join(' and ')} back to the boudoir.` };
}

// Keeper steps off the Echelon → the companions slip back into hiding. Fires for
// every player move, but consortsOf() is empty for anyone who isn't a keeper. While
// he's still aboard they stay put on whatever deck he last beckoned them to (he
// re-beckons to move them, or dismisses to send them home).
on('zone.entered', ({ actor, zone }) => {
  const mine = consortsOf(actor?.handle);
  if (!mine.length) return;
  if (getZone(zone)?.flags?.echelon) return;                      // still aboard
  retreatConsorts(mine);
});

// Keeper drops connection → tuck any of their exposed companions away. We match by
// devoted_to handle, excluding the departing session so ordering with the live-player
// removal doesn't matter.
on('player.logout', ({ id }) => {
  const online = new Set(getAllLivePlayers().filter(p => p.id !== id).map(p => p.handle));
  for (const npc of world.npcs.values()) {
    if (!isConsort(npc) || npc.zone_id === npc.home_zone) continue;
    if (online.has(npc.flags?.devoted_to)) continue;              // keeper still aboard
    retreatConsorts([npc]);
  }
});

// ── Furniture describe hook ─────────────────────────────────────────────────────
// `examine jacuzzi` / `examine sun loungers` adds a line for whichever consort is
// currently parked on it (onFurniture), MIS-tiered like everything else. The room
// list already names the occupant; this is the closer, hotter look.
const FURN_DESC = {
  jacuzzi: {
    tame: (n) => `${n} is lounging in the water here, arms spread along the tiled rim, watching you.`,
    hot:  (n) => `${n} is soaking here bare to the collarbone, flushed pink from the heat, thighs drifting apart in the froth as she watches you.`,
  },
  lounger: {
    tame: (n) => `${n} is stretched out on a lounger here, sunning herself, one knee lazily up.`,
    hot:  (n) => `${n} is stretched out on a lounger here, oiled and all but bare, a bikini strap slid off one shoulder, watching you from behind dark glasses.`,
  },
};

function onFurnitureDescribe(f, viewer) {
  if (!f?.zone_id || !f?.name) return undefined;
  const occupants = getZoneNpcs(f.zone_id).filter(n => isConsort(n) && n.onFurniture === f.name);
  if (!occupants.length) return undefined;
  const kind = /jacuzzi/i.test(f.name) ? 'jacuzzi' : 'lounger';
  const d = FURN_DESC[kind];
  const mis = viewer && isMisActive(viewer);
  const lines = occupants.map(n => (mis ? d.hot : d.tame)(n.name));
  return `<span class="text-dim">${lines.join(' ')}</span>`;
}

export const hooks = {
  'npc.talk': (payload) => onTalk(payload).catch(e => { console.error('[consort] onTalk:', e.message); return undefined; }),
  'furniture.describe': (f, viewer) => { try { return onFurnitureDescribe(f, viewer); } catch (e) { console.error('[consort] onFurnitureDescribe:', e.message); return undefined; } },
};

// ── Pour (keeper asks a present consort to pour him a drink from the bar) ────────
// She reads whatever bar is in the room — a container furniture stocked with
// alcoholic drinks (the suite bar) — pours one (named, or her pick), speaks in her
// own register, and hands it over. The bar is bottomless, so this just mints a
// fresh copy into the keeper's bag; nothing to decrement.
const withArt = (s) => /^[aeiou]/i.test(String(s)) ? `an ${s}` : `a ${s}`;

// The container furniture in a room whose restock list holds alcoholic drinks, and
// the drink ids it stocks. Filtering on the alcohol tag naturally skips the drug
// cabinet (a container too, but its items aren't drinks).
function barIn(zoneId) {
  for (const f of getZoneFurniture(zoneId)) {
    if (f.object_type !== 'container') continue;
    const ids = f.flags?.restock_items;
    if (!Array.isArray(ids)) continue;
    const drinks = ids.filter(id => getItem(id)?.tags?.laced_drug === 'drug_alcohol');
    if (drinks.length) return { furniture: f, drinks };
  }
  return null;
}

async function cmdPour(args, raw, player) {
  const pool = getZoneNpcs(player.current_zone).filter(n => isConsort(n) && n.flags?.devoted_to === player.handle);
  if (!pool.length) {
    const anyConsort = getZoneNpcs(player.current_zone).some(isConsort);
    return { type: 'error', message: anyConsort
      ? 'She only pours for the one she answers to.'
      : 'There’s no one here to pour for you. Beckon one of them to you first.' };
  }

  const bar = barIn(player.current_zone);
  if (!bar) return { type: 'error', message: 'There’s no bar here for her to pour from.' };

  // Strip filler; what's left can name a consort ("pour Bijou") and/or a drink
  // ("pour me a whiskey"). Either matched, or her pick.
  const want = args.join(' ').replace(/\b(me|a|an|the|some|one|please|drink|glass|of)\b/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  let npc = pick(pool);
  let drinkId = pick(bar.drinks);
  if (want) {
    const named = pool.find(n => String(n.name || '').toLowerCase().includes(want));
    if (named) npc = named;
    const wanted = bar.drinks.find(id => String(getItem(id)?.name || '').toLowerCase().includes(want));
    if (wanted) drinkId = wanted;
  }

  const item = getItem(drinkId);
  const dp = withArt(item?.name || 'drink');

  // Hand it over — stack onto an existing loose stack if the drink stacks.
  const stack = item && isStackable(item);
  let existing = [];
  if (stack) {
    const r = await query('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0 AND container_id IS NULL LIMIT 1', [player.id, drinkId]);
    existing = r.rows;
  }
  if (existing.length) await query('UPDATE player_inventory SET quantity=quantity+1 WHERE id=$1', [existing[0].id]);
  else await query('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)', [randomUUID(), player.id, drinkId]);

  // She speaks in her own register — hot only for the keeper if MIS is on; the room
  // (if anyone else is aboard) just sees the tame pour.
  const V = voiceOf(npc);
  const tameLine = pick(V.pourTame)(dp);
  const line = isMisActive(player) ? pick(V.pourHot)(dp) : tameLine;
  const othersMsg = formatChitchat(npc.name, tameLine).message;
  for (const p of getZonePlayers(player.current_zone)) {
    if (p.id !== player.id) sendToPlayer(p.id, { type: 'zone_event', message: othersMsg });
  }
  return { type: 'output', message: formatChitchat(npc.name, line).message };
}

export const commands = {
  beckon:  cmdBeckon,
  dismiss: cmdDismiss,
  pour:    cmdPour,
};

// Exposed for the regress suite.
export const _test = {
  isConsort, peeledForArousal, onTalk, consortTick,
  PAIR_PRIVATE, PAIR_WITH_KEEPER, arousal, moodCap, lastSpoke,
  rollMoodCap, PEEL_HOT, BARE_HOT,
  FELLATIO_SOLO, FELLATIO_DUO, FELLATIO_AT,
  VOICE, voiceOf,
  MAX_AROUSAL, AROUSED_AT,
  consortsOf, cmdBeckon, cmdDismiss, cmdPour, barIn, retreatConsorts,
  areaProfile, isIntimateZone, runAreaActivity, AREA_ACTIVITIES, ACT_MIN_MS,
  AREA_BANTER, onFurnitureDescribe,
};
