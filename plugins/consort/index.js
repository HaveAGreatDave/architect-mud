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
import { world, getZone, getZonePlayers, getZoneNpcs, getAllLivePlayers } from '../../server/engine/world.js';
import { sendToZone, sendToPlayer } from '../../server/engine/messaging.js';
import { isMisActive } from '../../server/engine/mis.js';
import { formatChitchat, moveEntity } from '../../server/engine/ai-behaviour.js';
import { on } from '../../server/engine/events.js';
import { exitTargets } from '../../server/engine/exits.js';
import { query } from '../../server/models/db.js';

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

const DEVOTED_TAME = [
  `watches you cross the cabin, everything in her turning to follow.`,
  `arranges herself where the light is kindest and waits for your eyes to find her.`,
  `"You've got that look. The one that means you're staying in tonight." She sounds glad of it.`,
  `"There's nowhere I'd rather be than exactly where you left me."`,
  `reaches out and just rests a hand on you, like she's checking you're real.`,
];
const DEVOTED_HOT = [
  `lets her robe fall open a careless inch and doesn't fix it, watching to see if you noticed.`,
  `"Come here. You don't have to do anything. Just let me be near you."`,
  `draws a slow line down her own throat, eyes on you, patient as the tide.`,
  `"Everything I've got is already yours. I just like reminding you."`,
];
const AROUSED_TAME = [
  `can't quite hold still now, warm and wanting under your gaze.`,
  `"You're going to make me forget my own name again, aren't you."`,
  `bites her lip and leans into the space between you like gravity.`,
];
const AROUSED_HOT = [
  `presses herself against you, past shy, all heat and hunger and yours.`,
  `"Please," she breathes, already half undone, "I've been good all day —"`,
  `moves over you slow and shameless, the last of her modesty on the floor with her clothes.`,
];

// Shy — a stranger is in the cabin. Never MIS-gated; there's nothing to see.
const SHY = [
  `draws the throw up over herself and keeps to the far end of the bed, saying nothing.`,
  `pretends to study the wall screen, arms folded, careful not to catch your eye.`,
  `pulls her robe closed at the throat and waits, plainly, for you to leave.`,
  `shifts so the other one is between her and you, and goes quiet.`,
  `gives you a small, distant nod and finds something across the cabin to look at.`,
];

// Peel / redress narration (generic; {g} is the garment). When she does come undone
// for him the hot beats aren't just undressing — she touches herself and reaches for
// you unbidden, no asking required.
const PEEL_HOT = [
  (n, g) => `${n} peels ${g} off slow, watching your face, and lets it drop.`,
  (n, g) => `${n} slips ${g} off and drags her own nails slow up the bared skin, shivering at her own touch.`,
  (n, g) => `${n} works ${g} loose, then takes your hand without a word and presses it to the warm skin beneath.`,
  (n, g) => `${n} lets ${g} fall and leans in to draw your palm down herself, guiding it exactly where she wants it.`,
  (n, g) => `${n} sheds ${g} and cups herself with a soft sound, eyes never once leaving you.`,
];
const BARE_HOT = [
  (n) => `${n} is completely bare now, offering the whole of herself with a slow, certain smile.`,
  (n) => `${n} is bare now, hands wandering her own body, watching for the moment they wander to you instead.`,
  (n) => `${n} is down to nothing and pulls you in by the wrist, laying your hands where she wants them.`,
  (n) => `${n} is naked and unhurried, one hand slow on herself and the other already reaching for you, certain of her welcome.`,
];
const peelTame    = (n, g) => `${n} slips ${g} off and lets it pool on the silk, eyes on you.`;
const peelHot     = (n, g) => pick(PEEL_HOT)(n, g);
const bareTame    = (n) => `${n} is down to nothing now, unhurried and unashamed in the warm dark.`;
const bareHot     = (n) => pick(BARE_HOT)(n);
const redressTame = (n, g) => `${n} draws ${g} back over herself, the moment folded away.`;
const redressHot  = (n, g) => `${n} slides ${g} back over warm skin, covering up.`;

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
];

// ── Talk (npc.talk hook — warm to the keeper, shy to everyone else) ─────────────
const TALK_TO_KEEPER = [
  `"You don't have to talk to me like a guest. It's just me. I'm always just here, for you."`,
  `ducks her head with a small, private smile. "Hello, you. I was hoping you'd come find me."`,
  `"Sit with me? You've been running this whole city. Let me have you a while."`,
  `"Anything you want to tell me, I'll keep. Anything you want to forget, I'll help with that too."`,
  `leans into you like a cat finding sun. "Mm. I missed you. The boat's too quiet without you in it."`,
];
const TALK_SHY = [
  `barely looks up, drawing the robe a little tighter. "...I don't really talk to guests. Sorry."`,
  `gives you a polite, distant smile and looks away. "You should ask whoever brought you aboard."`,
  `"Oh — no, I. I'm not part of the tour." She edges toward the far side of the cabin.`,
  `answers so softly you almost miss it. "I'm sure you're very nice. I'd just rather you sat over there."`,
  `"He didn't say anyone was coming down here." Her eyes flick to the hatch, hoping.`,
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
      idle: [ L('§ draws her knees up, rests her chin on them, and goes quiet.') ] },
    { key: 'rail',
      start: L('§ leans on the rail, chin on her hands, following a wake that isn’t there.'),
      idle: [ L('§ lets the Basin wind take her hair and doesn’t fix it.') ] },
    { key: 'sip',
      start: L('§ warms her hands around a glass and says nothing, content.'),
      idle: [ L('§ tips the last of the glass back and watches the horizon smudge grey.') ] },
    { key: 'throw',
      start: L('§ pulls a cashmere throw around her shoulders against the Basin chill.'),
      idle: [ L('§ burrows a little further into the throw, cosy.') ] },
  ],
  helipad: [
    { key: 'windswept',
      start: L('§ laughs as the open wind whips her hair across her face.'),
      idle: [ L('§ spreads her arms to the wind and lets the whole sky have her.') ] },
    { key: 'edge',
      start: L('§ drifts to the rail and looks out over the long drop to the Basin.'),
      idle: [ L('§ leans into the wind, fearless, grinning at the dark water.') ] },
    { key: 'huddle',
      start: L('§ hugs herself against the rotor-cold up here and grins through it.'),
      idle: [ L('§ bounces on her toes to keep warm, breath clouding.') ] },
  ],
  cabin: [
    { key: 'linger',
      start: L('§ drapes herself over the nearest rail and watches you move through the room.'),
      idle: [ L('§ shifts her weight, unhurried, following you with her eyes.') ] },
    { key: 'admire',
      start: L('§ trails a fingertip along the brushed titanium and takes it all in.'),
      idle: [ L('§ tilts her head at her own reflection in the bulkhead and half-smiles.') ] },
    { key: 'perch',
      start: L('§ perches on the edge of something expensive and crosses her legs.'),
      idle: [ L('§ swings a foot idly and waits, content just to be near you.') ] },
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
        if (strangerHere) {
          sendToZone(zoneId, formatChitchat(npc.name, pick(SHY)));
          lastSpoke.set(npc.id, now);
        } else if (keeperHere) {
          const hot = isMisActive(keeper);
          const pool = a >= AROUSED_AT ? (hot ? AROUSED_HOT : AROUSED_TAME)
                                       : (hot ? DEVOTED_HOT : DEVOTED_TAME);
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
// Claim `talk <consort>`: warm and devoted for the one they belong to, shy and
// deflecting for anyone else. Returning undefined falls through to normal dialogue.
async function onTalk({ player, npc }) {
  if (!player || !isConsort(npc)) return undefined;
  const devoted = npc.flags?.devoted_to;
  const line = (devoted && player.handle === devoted) ? pick(TALK_TO_KEEPER) : pick(TALK_SHY);
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

export const commands = {
  beckon:  cmdBeckon,
  dismiss: cmdDismiss,
};

// Exposed for the regress suite.
export const _test = {
  isConsort, peeledForArousal, onTalk, consortTick,
  PAIR_PRIVATE, PAIR_WITH_KEEPER, arousal, moodCap, lastSpoke,
  rollMoodCap, PEEL_HOT, BARE_HOT,
  MAX_AROUSAL, AROUSED_AT,
  consortsOf, cmdBeckon, cmdDismiss, retreatConsorts,
  areaProfile, isIntimateZone, runAreaActivity, AREA_ACTIVITIES, ACT_MIN_MS,
  AREA_BANTER, onFurnitureDescribe,
};
