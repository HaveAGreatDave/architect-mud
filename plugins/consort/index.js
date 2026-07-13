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
import { world, getZonePlayers, getZoneNpcs } from '../../server/engine/world.js';
import { sendToZone, sendToPlayer } from '../../server/engine/messaging.js';
import { isMisActive } from '../../server/engine/mis.js';
import { formatChitchat } from '../../server/engine/ai-behaviour.js';

// ── Tunables ────────────────────────────────────────────────────────────────
const MAX_AROUSAL   = 100;              // fully bare at this
const RISE_PER_TICK  = 20;              // arousal gained per tick while alone with their keeper
const COOL_PER_TICK  = 15;              // arousal shed per tick otherwise
const AROUSED_AT     = 66;              // arousal at/above which solo lines turn hot
const SPEAK_GAP_MS   = 32_000;          // min gap between an NPC's spoken beats
const SPEAK_CHANCE   = 0.5;             // an eligible tick where she just is, quietly
const SCENE_GAP_MS   = 4 * 60_000;      // keep the two-hander a treat, not a loop
const SCENE_CHANCE   = 0.45;            // ...and only sometimes when it's eligible
const SCENE_TURN_MS  = [4500, 8000];    // random delay between turns of a scene
const MAX_TURNS      = 6;               // cap however long a chosen thread runs

// ── Runtime state (ephemeral) ─────────────────────────────────────────────────
const arousal    = new Map(); // npcId  -> current arousal
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

// Peel / redress narration (generic; {g} is the garment).
const peelTame    = (n, g) => `${n} slips ${g} off and lets it pool on the silk, eyes on you.`;
const peelHot     = (n, g) => `${n} peels ${g} off slow, watching your face, and lets it drop.`;
const bareTame    = (n) => `${n} is down to nothing now, unhurried and unashamed in the warm dark.`;
const bareHot     = (n) => `${n} is completely bare now, offering the whole of herself with a slow, certain smile.`;
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
    ['B', `"I do not." A beat. "...it was the northern channel, though, wasn't it."`],
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

      for (const npc of consorts) {
        if (npc._combatTargetId || npc.posture === 'lying') continue;
        const devoted     = npc.flags?.devoted_to;
        const keeperHere  = !!devoted && players.some(p => p.handle === devoted);
        const strangerHere = anyStranger(devoted);
        const keeper      = keeperHere ? players.find(p => p.handle === devoted) : null;

        // Arousal only ever climbs when they're ALONE with the one they belong to.
        // A stranger in the room — even with him present — kills it.
        const warming = keeperHere && !strangerHere;
        let a = arousal.get(npc.id) || 0;
        a = warming ? Math.min(MAX_AROUSAL, a + RISE_PER_TICK) : Math.max(0, a - COOL_PER_TICK);
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

export const hooks = {
  'npc.talk': (payload) => onTalk(payload).catch(e => { console.error('[consort] onTalk:', e.message); return undefined; }),
};

export const commands = {};

// Exposed for the regress suite.
export const _test = {
  isConsort, peeledForArousal, onTalk, consortTick,
  PAIR_PRIVATE, PAIR_WITH_KEEPER, arousal, lastSpoke,
  MAX_AROUSAL, AROUSED_AT,
};
