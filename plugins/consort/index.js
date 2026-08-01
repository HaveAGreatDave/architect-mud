// plugins/consort/index.js
//
// Kept companions — living a life in their keeper's rooms
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
import { world, getZone, getZonePlayers, getZoneNpcs, getZoneFurniture, getAllLivePlayers, getLivePlayer } from '../../server/engine/world.js';
import { sendToZone, sendToPlayer } from '../../server/engine/messaging.js';
import { isMisActive } from '../../server/engine/mis.js';
import { addHorniness } from '../mis/mis-system.js';
import { registerInputMatcher } from '../../server/engine/plugins.js';
import { formatChitchat, moveEntity } from '../../server/engine/ai-behaviour.js';
import { on } from '../../server/engine/events.js';
import { exitTargets } from '../../server/engine/exits.js';
import { renderDialogueNode } from '../../server/engine/dialogue.js';
import { query } from '../../server/models/db.js';
import { getItem } from '../../server/engine/items-cache.js';
import { isStackable } from '../../server/engine/tags.js';
import { randomUUID } from 'crypto';
import { ARCHETYPES, PAIRINGS, archetypeOf, renderLine, soloSafe, needsOther } from './archetypes.js';
import { rehydrateConsorts, consortRowsOf, privateSpacesOf } from './hire.js';
import './bliss-app.js';   // registers the B.L.I.S.S. tablet app (MIS-gated)

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
const SETTLE_CHANCE  = 0.35;            // of those keeper two-handers, how often it's the "pick one of us" question
const SCENE_TURN_MS  = [4500, 8000];    // random delay between turns of a scene
const MAX_TURNS      = 6;               // cap however long a chosen thread runs
const FELLATIO_AT    = 84;              // arousal at/above which their signature act can happen
const FELLATIO_CHANCE = 0.5;            // ...and how readily, once peaked (they're experts, not shy)
const FELLATIO_DUO_CHANCE = 0.5;        // when both are here and peaked, chance the scene is a two-girl one

// ── Absence ───────────────────────────────────────────────────────────────────
// They notice how long you've been gone. The gap between the keeper leaving the
// room and coming back to it is measured in REAL time (it's about the player's
// absence, not the game clock) and, the first warm beat after a long enough one,
// they say so instead of running the ordinary devotion pools. Two bands, because
// "you were out for the afternoon" and "you were gone for days" are different
// conversations and every archetype has a written line for each.
// Consort ⇄ consort. Both have to be genuinely warmed up — a lower bar than the
// keeper acts (FELLATIO_AT), because turning to each other is where a warm evening
// goes before it peaks, not after. Paired or not; a pairing just brings history.
const MUTUAL_AT     = 70;   // BOTH consorts must be at least this aroused
const MUTUAL_CHANCE = 0.35; // ...and then only sometimes, on the shared scene cooldown

// How readily two non-paired consorts acknowledge each other on an eligible beat.
// Kept low: they're colleagues, not a double act, and this should read as texture
// rather than a running commentary between them.
const CO_PRESENCE_CHANCE = 0.3;

const ABSENCE_SHORT_MS = 2 * 3_600_000;    // a few hours out → they mention it
const ABSENCE_LONG_MS  = 20 * 3_600_000;   // the better part of a day+ → it lands harder

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

// Voice resolution. The register a consort speaks in comes from their ARCHETYPE
// (flags.consort_archetype), never from their name — that indirection is the whole
// reason a consort can be renamed, or generated with a random name, without
// silently falling back to a generic voice. The pools themselves live in
// archetypes.js alongside the rest of the authored personality.
const voiceOf = (npc) => archetypeOf(npc);

// Pick a line from a pool and render it for this consort: pronouns resolved to
// their sex, verb agreement fixed, name slots filled, and any beat written for two
// consorts (the §other slot) either aimed at a present companion or skipped.
function say(npc, pool, other = null) {
  const usable = other ? pool : soloSafe(pool);
  if (!usable.length) return null;
  return renderLine(pick(usable), npc, { other: other && other.name });
}

// Which absence pool (if any) this consort owes the keeper right now. Set by the
// tick when he walks back in after a long enough gap, consumed by the first warm
// beat that fires, and cleared the moment he leaves again — so the "you were gone
// for days" line lands once, on his return, and never on a loop.
function absenceTierFor(npc, keeper, now) {
  if (!keeper || !npc._pendingAbsence) return null;
  const gap = npc._pendingAbsence;
  npc._pendingAbsence = 0;
  return gap >= ABSENCE_LONG_MS ? 'missLong' : 'missShort';
}

// Another consort in the room to aim a two-hander line at, if there is one.
function companionFor(npc, zoneId) {
  return getZoneNpcs(zoneId).find(n => isConsort(n) && n.id !== npc.id) || null;
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

// Once she's fully bare and warm with him, she doesn't just wait — she touches
// herself, unhurried and unashamed, a whole variety of it. [tame, hot]; § → name.
const NAKED_SOLO = [
  [`§ stretches out bare and unhurried, comfortable in her own skin.`,
   `§ lies back naked and lets a hand drift between her thighs, touching herself lazily while she watches you.`],
  [`§ runs her hands slowly over herself, lost in the warmth.`,
   `§ cups her own breasts and rolls a nipple between her fingers, sighing, in no hurry for you to join in.`],
  [`§ shifts against the silk, warm and languid.`,
   `§ works two fingers slow between her legs, hips rocking, putting on a show she knows you're watching.`],
  [`§ arches in a long, contented stretch.`,
   `§ spreads herself on the sheets and rubs slow circles over her clit, biting her lip at you.`],
  [`§ traces idle patterns across her own skin.`,
   `§ palms her breasts and grinds down against her own hand, breath going shallow, eyes never leaving you.`],
  [`§ hums something low and settles deeper into the cushions.`,
   `§ slides a hand down her stomach and lower, teasing herself open with a soft, wanting sound.`],
];

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
    ['A', `§ draws you down onto the silk, and §other is already there.`,
          `§ draws you down onto the silk and peels you open while §other settles in beside her, both grinning.`],
    ['B', `§ presses close on your other side, sharing the space easily.`,
          `§ takes you into her mouth first, slow and deep, while the other watches, waiting her turn.`],
    ['A', `§ leans in to trade places, unhurried and generous.`,
          `§ takes over without missing a beat, the two of them passing you between warm mouths like they've rehearsed it.`],
    ['B', `§ murmurs something to the other and they both laugh softly against you.`,
          `§ and her twin work you together, one deep and one teasing, then swap, tireless and adoring.`],
    ['A', `§ rests her head on your stomach, spent and pleased with the both of them.`,
          `§ kisses her way back up you while §other finishes you off, and they share a look that says they'll do it again the second you can.`],
  ],
];

// The rest of their repertoire — same [who, tame, hot] shape as the fellatio
// threads (§ → speaker name). RIDE (she works him from on top) and HANDJOB round
// out the acts they'll start unbidden when peaked, or on command (see cmdConsortDirect).
const RIDE_SOLO = [
  [
    ['A', `§ pushes you flat and climbs over you, taking her time about it.`,
          `§ pushes you flat, straddles your hips, and sinks down onto you with a long, shameless sigh.`],
    ['A', `§ braces her hands on your chest and finds a slow rhythm.`,
          `§ rolls her hips in a slow, filthy grind, riding you deep, watching your face the whole way down.`],
    ['A', `§ leans down close, breath warm against your ear.`,
          `§ rides you harder, breasts swaying, moaning how much she's yours between ragged breaths.`],
    ['A', `§ tips her head back, utterly lost in it.`,
          `§ slams down onto you and clenches tight, chasing it, like she never wants you to leave.`],
  ],
  [
    ['A', `§ eases you back against the pillows and settles over you.`,
          `§ guides you inside and rocks down, unhurried, savouring every inch like she's got all night.`],
    ['A', `§ threads her fingers through yours and keeps moving.`,
          `§ rides you slow and deep, pinning your hands, murmuring that this is exactly where she belongs.`],
    ['A', `§ shivers and picks up the pace.`,
          `§ grinds down faster, thighs trembling, gasping your name like a prayer she means every word of.`],
  ],
];
const RIDE_DUO = [
  [
    ['A', `§ climbs over you while §other settles in close beside you both.`,
          `§ sinks down onto you while §other kisses her way up your chest, the two of them grinning at each other.`],
    ['B', `§ leans in, sharing the moment, hands roaming.`,
          `§ straddles your face while the other rides you, and the cabin fills with the sound of the two of them.`],
    ['A', `§ trades places without a word, generous and unhurried.`,
          `§ lifts off and §other takes her in a heartbeat, keeping you buried and gasping between them.`],
    ['A', `§ collapses against you, spent and glowing.`,
          `§ and her twin ride you between them until you're wrung out, then curl up warm on either side of you.`],
  ],
];
const HANDJOB_SOLO = [
  [
    ['A', `§ reaches into your lap with a knowing little smile.`,
          `§ frees your cock and wraps a warm hand around it, thumb already circling the head.`],
    ['A', `§ works you slow, reading your face for every tell.`,
          `§ strokes you in a steady, twisting rhythm, matching every breath you take and drawing out the next.`],
    ['A', `§ rests her head on your shoulder and keeps going.`,
          `§ jerks you faster, breath hot at your throat, whispering how much she loves the weight of you in her hand.`],
  ],
];

// ── The same repertoire, male consorts ──────────────────────────────────────────
// Consorts come in both sexes, and these threads are the one place where a pronoun
// swap isn't enough: the pools above are written for a female body and `ride` in
// particular describes an act that simply works the other way round when the
// consort is male. So each act carries a female and a male thread set, chosen off
// flags.consort_sex at scene time. Same [who, tame, hot] shape, same `§` → speaker.
const FELLATIO_SOLO_M = [
  [
    ['A', `§ sinks to his knees in front of you and looks up, in no hurry at all.`,
          `§ sinks to his knees in front of you, mouth already parting, eyes up and adoring.`],
    ['A', `§ leans in close, breath warm, and takes his time.`,
          `§ takes you in slow and deep, throat opening for it like he's done this a thousand times and loved every one.`],
    ['A', `§ finds a patient rhythm, watching your face for every tell.`,
          `§ hollows his cheeks and works you with his tongue, reading each breath and giving you exactly what it asks for.`],
    ['A', `§ hums low, savouring it, unbothered by time.`,
          `§ takes you to the base and holds you there, throat working, eyes streaming and delighted about it.`],
    ['A', `§ eases back with a soft, satisfied sound and rests his cheek on your thigh.`,
          `§ pulls off slow, kisses the length of you, and murmurs, "You taste like the best part of my whole day."`],
  ],
  [
    ['A', `§ tugs you toward the bed by the waistband, grinning.`,
          `§ frees you from your clothes with practised hands and licks his lips at what he finds.`],
    ['A', `§ starts slow and teasing, all lips and warm breath.`,
          `§ drags his tongue up the underside of you, then swallows you down without warning, eyes locked on yours.`],
    ['A', `§ settles into it, thorough and unhurried.`,
          `§ works you deep and slow, one hand cupping you, the other flat on your hip to feel every twitch.`],
    ['A', `§ looks up at you like there's nowhere else in the world he'd rather be.`,
          `§ groans around you, the sound of it running straight up your spine, and takes you deeper still.`],
  ],
];
const FELLATIO_DUO_M = [
  [
    ['A', `§ draws you down onto the silk, and §other is already there.`,
          `§ draws you down onto the silk and peels you open while §other settles in beside him, both grinning.`],
    ['B', `§ presses close on your other side, sharing the space easily.`,
          `§ takes you into his mouth first, slow and deep, while the other watches, waiting his turn.`],
    ['A', `§ leans in to trade places, unhurried and generous.`,
          `§ takes over without missing a beat, the two of them passing you between warm mouths like they've rehearsed it.`],
    ['B', `§ murmurs something to the other and they both laugh softly against you.`,
          `§ and §other work you together, one deep and one teasing, then swap, tireless and adoring.`],
    ['A', `§ rests his head on your stomach, spent and pleased with the both of them.`,
          `§ kisses his way back up you while §other finishes you off, and they share a look that says they'll do it again the second you can.`],
  ],
];
const RIDE_SOLO_M = [
  [
    ['A', `§ pushes you flat and swings a leg over you, taking his time about it.`,
          `§ pushes you flat, straddles your hips, and works himself down onto you with a long, shameless groan.`],
    ['A', `§ braces his hands on your chest and finds a slow rhythm.`,
          `§ rolls his hips in a slow, filthy grind, taking you deep, watching your face the whole way down.`],
    ['A', `§ leans down close, breath warm against your ear.`,
          `§ rides you harder, thighs flexing either side of you, telling you between ragged breaths how much he's yours.`],
    ['A', `§ tips his head back, utterly lost in it.`,
          `§ drives down onto you and clenches tight, chasing it, like he never wants you to leave.`],
  ],
  [
    ['A', `§ eases you back against the pillows and settles over you.`,
          `§ guides you into him and rocks down, unhurried, savouring every inch like he's got all night.`],
    ['A', `§ threads his fingers through yours and keeps moving.`,
          `§ takes you slow and deep, pinning your hands, murmuring that this is exactly where he belongs.`],
    ['A', `§ shivers and picks up the pace.`,
          `§ grinds down faster, whole body shaking, gasping your name like a prayer he means every word of.`],
  ],
];
const RIDE_DUO_M = [
  [
    ['A', `§ swings over you while §other settles in close beside you both.`,
          `§ works himself down onto you while §other kisses his way up your chest, the two of them grinning at each other.`],
    ['B', `§ leans in, sharing the moment, hands roaming.`,
          `§ straddles your face while the other rides you, and the cabin fills with the sound of the two of them.`],
    ['A', `§ trades places without a word, generous and unhurried.`,
          `§ lifts off and §other takes his place in a heartbeat, keeping you buried and gasping between them.`],
    ['A', `§ collapses against you, spent and glowing.`,
          `§ and §other ride you between them until you're wrung out, then curl up warm on either side of you.`],
  ],
];
const HANDJOB_SOLO_M = [
  [
    ['A', `§ reaches into your lap with a knowing little smile.`,
          `§ frees your cock and wraps a warm hand around it, thumb already circling the head.`],
    ['A', `§ works you slow, reading your face for every tell.`,
          `§ strokes you in a steady, twisting rhythm, matching every breath you take and drawing out the next.`],
    ['A', `§ rests his head on your shoulder and keeps going.`,
          `§ jerks you faster, breath hot at your throat, telling you exactly how good you feel in his hand.`],
  ],
];

// ── Consort ⇄ consort ───────────────────────────────────────────────────────────
// Two consorts, both warmed right up, in a private room. Sooner or later their
// attention lands on each other rather than on the keeper — and it isn't a
// performance for him, which is rather the point of it. Fires for ANY two consorts
// warm enough, paired or not: a pairing brings a history to it, but two colleagues
// left aroused in the same room don't need one.
//
// Three pools by the sexes involved. In the mixed pool 'A' is ALWAYS the woman and
// 'B' the man — mutualPoolFor() orders the cast to match, so the thread never has
// to hedge about who is doing what. Same [who, tame, hot] shape as the keeper acts.
const MUTUAL_FF = [
  [
    ['A', `§ catches §other's eye across the room and holds it a beat too long.`,
          `§ catches §other's eye, and whatever passes between them ends with §other being pulled into her lap.`],
    ['B', `§ goes willingly, settling in close.`,
          `§ straddles her and kisses her open-mouthed, both of them past pretending this was going anywhere else.`],
    ['A', `§ works loose what little §other was still wearing.`,
          `§ strips the last of it off §other and gets her mouth on a bared breast, drawing a sound out of her.`],
    ['B', `§ arches into her, breath gone ragged.`,
          `§ rides §other's hand, thighs shaking, swearing softly into her hair.`],
    ['A', `§ holds §other through it, murmuring something private.`,
          `§ works her through it and doesn't stop until §other has gone boneless and swearing in her arms.`],
    ['B', `§ takes a moment, then turns to return the favour, unhurried.`,
          `§ slides down between §other's thighs to return it properly, in no hurry whatsoever.`],
  ],
  [
    ['B', `§ tugs §other down onto the silk beside her without a word.`,
          `§ pulls §other down onto the silk and is already working her out of the last of it.`],
    ['A', `§ laughs low and lets herself be moved.`,
          `§ laughs low, lets herself be moved, and hooks a leg over §other to keep her close.`],
    ['B', `§ presses close, hands wandering.`,
          `§ works two fingers into §other and swallows the noise she makes with a kiss.`],
    ['A', `§ clings to her, undone.`,
          `§ grinds down onto §other's hand, shameless, chasing it with her whole body.`],
  ],
];
const MUTUAL_MM = [
  [
    ['A', `§ crosses to §other and stands close enough to make the question obvious.`,
          `§ crosses to §other, takes a fistful of his shirt, and kisses him hard enough to answer the question.`],
    ['B', `§ answers it by pulling him in.`,
          `§ shoves him back against the wall and gets a hand down the front of his shorts.`],
    ['A', `§ steers them both toward the bed, laughing at something unsaid.`,
          `§ strips §other on the way to the bed, mouth working down his throat, neither of them patient about it.`],
    ['B', `§ pins him there and takes his time.`,
          `§ pins §other flat and works him with a slow, sure hand, watching every reaction he can drag out.`],
    ['A', `§ swears, arches, and gives up on being quiet.`,
          `§ arches off the sheets and comes apart under §other's hands, past caring who hears.`],
    ['B', `§ settles beside him, breathing hard, thoroughly pleased.`,
          `§ drops down beside §other and lets him return it, unhurried, the pair of them in no rush at all.`],
  ],
  [
    ['B', `§ knocks his shoulder into §other's and doesn't step away again.`,
          `§ backs §other into the nearest surface and kisses him like it's been building all week.`],
    ['A', `§ makes a low sound and pulls him closer.`,
          `§ drags §other's hand where he wants it and groans into his mouth.`],
    ['B', `§ works him over slow, watching his face.`,
          `§ sinks to his knees and takes §other in his mouth, unhurried, entirely happy about it.`],
  ],
];
// Mixed: 'A' is the woman, 'B' the man. Cast is ordered to match.
const MUTUAL_MIXED = [
  [
    ['B', `§ catches §other watching him and raises an eyebrow.`,
          `§ catches §other watching him, crosses the room, and takes her face in both hands.`],
    ['A', `§ doesn't pretend she wasn't.`,
          `§ doesn't pretend she wasn't, and pulls him down onto the bed by the waistband.`],
    ['B', `§ works her out of what's left of it, unhurried.`,
          `§ peels the last of it off §other and puts his mouth everywhere he's been thinking about.`],
    ['A', `§ pulls him over her, past waiting.`,
          `§ hooks her legs around §other and takes him in with a long, filthy sigh.`],
    ['B', `§ finds a rhythm and keeps it.`,
          `§ moves in §other slow and deep, one hand at her throat, reading every sound she makes.`],
    ['A', `§ comes apart under him, unashamed about it.`,
          `§ clenches around him and comes apart, dragging §other over the edge right behind her.`],
  ],
  [
    ['A', `§ takes §other's hand and simply doesn't let go of it.`,
          `§ takes §other's hand, puts it where she wants it, and watches him work out what happens next.`],
    ['B', `§ obliges without needing telling twice.`,
          `§ obliges, fingers working her slow, mouth at her ear telling her exactly what he's going to do after.`],
    ['A', `§ turns and pulls him with her.`,
          `§ turns over and pulls §other in behind her, reaching back to guide him.`],
    ['B', `§ folds himself around her and stays there.`,
          `§ takes her from behind, slow and deep, arm locked across her chest to hold her against him.`],
  ],
];

// The right mutual pool for two consorts, and the cast order the thread expects.
// Returns null when there's no pool (shouldn't happen — all four sex combinations
// are covered by three pools).
function mutualFor(a, b) {
  const sa = sexOf(a), sb = sexOf(b);
  if (sa === 'female' && sb === 'female') return { pool: MUTUAL_FF, A: a, B: b };
  if (sa === 'male' && sb === 'male') return { pool: MUTUAL_MM, A: a, B: b };
  // Mixed — the thread is written with the woman as 'A', so order the cast to suit
  // rather than making every line hedge about who's who.
  return sa === 'female' ? { pool: MUTUAL_MIXED, A: a, B: b } : { pool: MUTUAL_MIXED, A: b, B: a };
}

// ── The same repertoire, for a FEMALE keeper ────────────────────────────────────
// The keeper is a PLAYER, and players are male or female. Everything above is
// written for a male keeper because this plugin started life as two women on one
// man's yacht — which left every female player who kept a consort with no
// signature acts at all. These are the other half of the matrix: what a consort
// does for a woman, in both consort sexes. Same [who, tame, hot] shape.
const ORAL_F_SOLO_F = [   // female consort → female keeper
  [
    ['A', `§ eases you back and kisses her way down, in no hurry at all.`,
          `§ eases you back, hooks your thighs over her shoulders, and settles in like she's got all night.`],
    ['A', `§ takes her time about it, warm and unhurried.`,
          `§ works you slow with her tongue, reading every shift of your hips and giving back exactly what they ask for.`],
    ['A', `§ hums against you, entirely content.`,
          `§ moans into you, the vibration of it going straight through you, and slides two fingers in to match her mouth.`],
    ['A', `§ keeps at it, patient past the point you can stand.`,
          `§ works you right to the edge and holds you there, refusing to be hurried, until you're begging in earnest.`],
    ['A', `§ rests her cheek against your thigh, thoroughly pleased with herself.`,
          `§ takes you over the edge and works you through every last aftershock, then looks up at you, mouth wet and smug.`],
  ],
  [
    ['A', `§ kneels between your knees and looks up for permission she already has.`,
          `§ kneels between your knees, drags your underthings off with her teeth, and grins up at you.`],
    ['A', `§ starts slow, all warmth and patience.`,
          `§ licks into you slow and broad, then narrows to exactly the spot that makes you swear.`],
    ['A', `§ holds your hips steady when they start to move.`,
          `§ pins your hips flat with one forearm and keeps her rhythm no matter how much you buck against it.`],
  ],
];
const ORAL_F_SOLO_M = [   // male consort → female keeper
  [
    ['A', `§ eases you back onto the bed and kisses his way down, unhurried.`,
          `§ eases you back, drags you to the edge of the bed by the hips, and kneels.`],
    ['A', `§ takes his time, reading every reaction.`,
          `§ works you with his tongue, slow and thorough, one hand splayed across your stomach to feel every twitch.`],
    ['A', `§ makes a low, satisfied sound against you.`,
          `§ groans into you and works two fingers in, curling them until your back comes off the sheets.`],
    ['A', `§ keeps going long past the point of politeness.`,
          `§ doesn't let up, holding you open and working you through it while you shake apart under him.`],
    ['A', `§ rests his forehead on your hip, breathing hard, delighted.`,
          `§ kisses his way back up you, mouth still wet, entirely pleased with the state he's left you in.`],
  ],
  [
    ['A', `§ tips you back and settles in without being asked.`,
          `§ tips you back, hauls your thighs over his shoulders, and gets his mouth on you.`],
    ['A', `§ works patiently, watching your face.`,
          `§ licks you in long, deliberate strokes, eyes up, watching every second of what it does to you.`],
    ['A', `§ holds you steady and keeps his rhythm.`,
          `§ locks an arm across your hips and refuses to be rushed, no matter what you do to his hair.`],
  ],
];
const ORAL_F_DUO_F = [    // two female consorts → female keeper
  [
    ['A', `§ draws you down onto the silk while §other settles in beside you.`,
          `§ draws you down onto the silk and §other is already working your clothes off you.`],
    ['B', `§ kisses her way down as the other keeps you occupied.`,
          `§ settles between your thighs while §other kisses you quiet, the two of them working you from both ends.`],
    ['A', `§ trades places, generous about it.`,
          `§ takes over below without missing a beat while §other moves up to your mouth and your breasts.`],
    ['B', `§ murmurs something to the other and they both laugh against your skin.`,
          `§ and §other work you together, one mouth and two sets of hands, tireless and unhurried.`],
    ['A', `§ curls up against your side, spent and warm.`,
          `§ works you through the last of it while §other holds you steady, and neither of them lets go afterwards.`],
  ],
];
const ORAL_F_DUO_M = [    // two male consorts → female keeper
  [
    ['A', `§ draws you down while §other takes your other side.`,
          `§ draws you down and §other strips you between them, unhurried and entirely coordinated.`],
    ['B', `§ moves down as the other keeps your attention.`,
          `§ settles between your thighs while §other kisses you and works a hand over your breasts.`],
    ['A', `§ takes his turn without a word being needed.`,
          `§ takes over below while §other moves up, the two of them passing you between them like they've done this before.`],
    ['B', `§ says something low to the other and they both grin.`,
          `§ and §other work you together, one mouth below and one above, until you can't tell which is which.`],
    ['A', `§ settles alongside you, thoroughly satisfied.`,
          `§ works you through it while §other holds you against his chest, and they leave you wrung out between them.`],
  ],
];
const RIDE_F_SOLO_M = [   // female keeper takes a male consort
  [
    ['A', `§ lies back and pulls you over him, letting you set the pace.`,
          `§ lies back and pulls you astride him, hands at your hips, letting you take him at your own pace.`],
    ['A', `§ lets you take the lead entirely.`,
          `§ lets you work yourself down onto him and holds still, jaw tight, watching you use him exactly how you like.`],
    ['A', `§ meets your rhythm when you find it.`,
          `§ starts driving up to meet you, hands hard on your hips, the pair of you finding it together.`],
    ['A', `§ holds on and gives you everything.`,
          `§ pulls you down flush and thrusts up into you, breathless, telling you how good you feel.`],
    ['A', `§ collapses back, wrecked and grinning.`,
          `§ falls back wrecked and grinning, and doesn't let you climb off for a good long while.`],
  ],
];
const RIDE_F_SOLO_F = [   // female consort, female keeper — no strap required
  [
    ['A', `§ climbs over you and settles her weight down slow.`,
          `§ swings a leg over you and settles down until you're pressed together hot and slick.`],
    ['A', `§ finds a rhythm and keeps it.`,
          `§ grinds down against you in a slow filthy roll, both of you gasping every time she rocks forward.`],
    ['A', `§ leans down close, breath at your ear.`,
          `§ works a hand between you and keeps grinding, telling you exactly what you're doing to her.`],
    ['A', `§ shakes and buries her face in your neck.`,
          `§ shudders through it against you and drags you over with her, the pair of you a mess and past caring.`],
  ],
];
const RIDE_F_DUO_F = [
  [
    ['A', `§ settles over you while §other takes the space beside your head.`,
          `§ straddles your hips while §other straddles your face, the two of them steadying each other.`],
    ['B', `§ leans in, sharing the moment.`,
          `§ rocks down against your mouth while §other grinds against you below, both of them working you at once.`],
    ['A', `§ trades places with the other, unhurried.`,
          `§ swaps with §other without a word, and the whole thing starts again from the other end.`],
    ['A', `§ folds down against you, spent.`,
          `§ and §other collapse either side of you, all three of you wrecked and tangled up together.`],
  ],
];
const RIDE_F_DUO_M = [
  [
    ['A', `§ lies back and lets you take him while §other moves in close.`,
          `§ lies back and lets you ride him while §other kneels up beside your head.`],
    ['B', `§ takes the place beside you, hands roaming.`,
          `§ guides your mouth to him while §other works you from below, the two of them setting a rhythm between them.`],
    ['A', `§ meets your pace, holding on.`,
          `§ drives up into you while §other holds your hair, the pair of them entirely coordinated about it.`],
    ['A', `§ gives out first, laughing about it.`,
          `§ gives out first and §other finishes what he started, and they leave you shaking between them.`],
  ],
];
const HAND_F_SOLO_F = [
  [
    ['A', `§ slides a hand into your lap with a knowing look.`,
          `§ slides a hand between your thighs and starts working you slow, watching your face the whole time.`],
    ['A', `§ keeps at it, patient, reading you.`,
          `§ works two fingers into you and sets a rhythm with her thumb, unhurried and infuriatingly accurate.`],
    ['A', `§ rests her head on your shoulder and doesn't stop.`,
          `§ keeps going, mouth at your throat, telling you how wet you've got for her.`],
  ],
];
const HAND_F_SOLO_M = [
  [
    ['A', `§ reaches over and slides a hand into your lap.`,
          `§ slides a hand between your thighs and starts working you, slow and sure.`],
    ['A', `§ works patiently, watching for every tell.`,
          `§ pushes two fingers into you and curls them, learning exactly what makes you swear and doing it again.`],
    ['A', `§ presses close and keeps going.`,
          `§ keeps at it with his mouth at your ear, describing in detail what he intends to do to you next.`],
  ],
];

// The acts they'll perform on the keeper — auto (when peaked) or on command. Each
// is MIS-tiered, timed, and raises the keeper's arousal (gain per beat).
//
// A KEEPER IS A PLAYER, AND PLAYERS ARE MALE OR FEMALE, so every act is a full
// matrix indexed [keeper sex][consort sex]. There is no `maleOnly` flag any more:
// that was a fossil from when this plugin served exactly one man, and what it
// actually did was give every female player who kept a consort nothing at all.
//
// Act keys are the ROLE, not the anatomy ('oral', not 'suck') — the same request
// means different things depending on who is asking, which is the entire point of
// the matrix. Player-facing verbs map onto these keys in DIRECT_ACT.
//
// Resolve through actSoloFor()/actDuoFor(). Never index solo/duo directly.
const KEEPER_ACTS = {
  oral: {
    gain: 16,
    solo: {
      male:   { female: FELLATIO_SOLO, male: FELLATIO_SOLO_M },
      female: { female: ORAL_F_SOLO_F, male: ORAL_F_SOLO_M },
    },
    duo: {
      male:   { female: FELLATIO_DUO,  male: FELLATIO_DUO_M },
      female: { female: ORAL_F_DUO_F,  male: ORAL_F_DUO_M },
    },
  },
  ride: {
    gain: 16,
    solo: {
      male:   { female: RIDE_SOLO,     male: RIDE_SOLO_M },
      female: { female: RIDE_F_SOLO_F, male: RIDE_F_SOLO_M },
    },
    duo: {
      male:   { female: RIDE_DUO,      male: RIDE_DUO_M },
      female: { female: RIDE_F_DUO_F,  male: RIDE_F_DUO_M },
    },
  },
  hand: {
    gain: 12,
    solo: {
      male:   { female: HANDJOB_SOLO,  male: HANDJOB_SOLO_M },
      female: { female: HAND_F_SOLO_F, male: HAND_F_SOLO_M },
    },
    duo: null,
  },
};

const sexOf = (npc) => (npc?.flags?.consort_sex === 'male' ? 'male' : 'female');
// The keeper's own sex. Anything not explicitly female reads as male, which keeps
// every pre-existing keeper on exactly the threads they had before this change.
const keeperSexOf = (p) => (p?.biological_sex === 'female' ? 'female' : 'male');

// ── Co-presence: consorts who are NOT a pairing ─────────────────────────────────
// Two consorts kept by the same person, sharing a room, who were never written for
// each other. They don't run the two-hander threads — those belong to a PAIRING and
// assume a shared history these two don't have — but they're not furniture either.
// This is the basic register: sizing each other up, working out the pecking order,
// the small courtesies and small territorialities of two people in the same job.
//
// Keyed by BOTH sexes, speaker first — `fm` is a woman reacting to a man, `mf` the
// reverse — because who's in the room changes the reaction in both directions.
// Each entry is [tame, hot]; `§` → speaker, `§other` → the other consort. The hot
// variant only reaches MIS-opted-in eyes, same as everything else here.
const CO_PRESENCE = {
  ff: [
    [`§ looks §other over once, unhurried, and files whatever she concludes away for later.`,
     `§ takes in §other's body with a slow, frank appraisal, and doesn't much care about being caught at it.`],
    [`§ and §other divide the room between them without a word being said about it.`,
     `§ brushes past §other closer than the space required, and neither of them moves away.`],
    [`"You're new." § says it to §other in a tone that gives away precisely nothing.`,
     `"You're new." § lets her eyes travel the whole way down §other. "...I can see the appeal. Don't get comfortable."`],
    [`§ adjusts §other's collar without being asked, and §other lets her.`,
     `§ straightens §other's robe with unnecessary care, fingertips lingering at the throat.`],
    [`§ moves a cushion so there's somewhere for §other to sit. It isn't quite friendliness.`,
     `§ makes room beside her and pats it once, watching to see whether §other takes the invitation.`],
    [`"You get talked about, you know." § tells §other that much and no more.`,
     `"You get talked about, you know." § holds §other's eye, and the smile arrives slowly. "In detail. I asked."`],
  ],
  fm: [
    [`§ studies §other with open curiosity, as though working out what he's for.`,
     `§ looks §other over the way you'd price something, and lets him watch her do it.`],
    [`§ gives §other a small nod — colleagues, near enough — and leaves it there.`,
     `§ trails a hand across §other's shoulders on her way past, entirely deliberate.`],
    [`"So there's two of us now." § says it at §other rather than to the room.`,
     `"So there's two of us now." § looks §other up and down. "That could be interesting or it could be tiresome. Surprise me."`],
    [`§ makes space for §other without looking up.`,
     `§ pulls §other down beside her by the shirt front and goes back to what she was doing.`],
    [`§ finds §other's presence obscurely reassuring and doesn't examine why.`,
     `§ leans back against §other like he's furniture that happens to be warm, perfectly at ease about it.`],
  ],
  mf: [
    [`§ stands when §other comes in, out of a habit he can't place the origin of.`,
     `§ stands when §other comes in, and takes rather too long about looking away again.`],
    [`§ gives §other the better chair without making anything of it.`,
     `§ gives §other the better chair, and stays standing close enough to be noticed.`],
    [`"You've been here longer than me." § makes it a question at §other without asking one.`,
     `"You've been here longer than me." § lets the pause sit on §other. "You'll have to tell me what's liked around here. All of it."`],
    [`§ keeps half an eye on §other, the way you watch someone you haven't decided about.`,
     `§ watches §other cross the room and doesn't pretend he was looking anywhere else.`],
    [`§ pours two and slides one to §other without asking whether she wanted it.`,
     `§ pours two, hands §other hers, and lets his fingers stay on the glass a moment too long.`],
  ],
  mm: [
    [`§ and §other acknowledge each other with the smallest possible movement of the head.`,
     `§ holds §other's eye a beat past comfortable, and something unspoken gets settled.`],
    [`§ takes the other side of the room from §other. Not hostile. Just arranged.`,
     `§ ends up shoulder to shoulder with §other and neither of them bothers to fix it.`],
    [`"Long day?" § asks §other, and means it.`,
     `"Long day?" § asks, and puts a hand on the back of §other's neck without waiting for an answer.`],
    [`§ works out the pecking order with §other in about four seconds and abides by it.`,
     `§ decides the pecking order with §other in about four seconds, and looks quietly pleased with the result.`],
    [`§ and §other fall into the easy silence of two people doing the same job.`,
     `§ leans into §other in the easy way of two people who've already worked out what they are to each other.`],
  ],
};

// The right co-presence pool for a speaker and the other consort in the room —
// speaker's sex first. Both directions differ deliberately.
function coPresenceFor(npc, other) {
  const key = `${sexOf(npc) === 'male' ? 'm' : 'f'}${sexOf(other) === 'male' ? 'm' : 'f'}`;
  return CO_PRESENCE[key] || null;
}

// Two consorts are a PAIRING only if they share a pairing key. Anyone else in the
// room is a colleague, and gets the co-presence register rather than the threads.
const arePaired = (a, b) =>
  !!a?.flags?.consort_pairing && a.flags.consort_pairing === b?.flags?.consort_pairing;

// The solo thread set for this consort.
function actSoloFor(act, npc, keeper) {
  return act?.solo?.[keeperSexOf(keeper)]?.[sexOf(npc)] || null;
}

// The duo thread set for a pair — only when BOTH consorts are the same sex. A
// mixed-sex pairing is perfectly legal (the roster rolls each member's sex
// independently), but a duo thread describes both bodies at once, so rather than
// write a further set for every combination we fall back to a solo scene.
// Nothing is lost but the two-at-once variant.
function actDuoFor(act, a, b, keeper) {
  if (!act?.duo || !a || !b) return null;
  if (sexOf(a) !== sexOf(b)) return null;
  return act.duo[keeperSexOf(keeper)]?.[sexOf(a)] || null;
}

// Play a MIS-tiered multi-turn scene aimed at the keeper. `speakers` maps role
// ('A'/'B') to the consort object for that turn. Re-checks its audience each beat
// and bails if the keeper leaves or a stranger walks in mid-scene. Their attention
// lands on the keeper as arousal — the act is the timed kind and raises his horniness
// beat by beat (only the opted-in keeper accrues it).
function playKeeperScene(zoneId, thread, speakers, keeperId = null, gain = 14) {
  sceneZones.add(zoneId);
  let i = 0;
  const cast = Object.values(speakers);
  const step = async () => {
    const present = cast.every(n => n && !n._dead && n.zone_id === zoneId);
    if (i >= thread.length || !getZonePlayers(zoneId).length || !present) { sceneZones.delete(zoneId); return; }
    const [who, tame, hot] = thread[i++];
    const speaker = speakers[who] || speakers.A;
    // §other is the OTHER member of the cast, not the speaker — resolve through
    // renderLine so pronouns, verb agreement and both name slots all land.
    const other = cast.find(n => n && n.id !== speaker.id);
    const fill = (l) => renderLine(l, speaker, { other: other?.name });
    tieredZoneLine(zoneId, fill(tame), fill(hot));
    const now = Date.now();
    for (const s of cast) { lastSpoke.set(s.id, now); if (s._ai) s._ai.lastSay = now; }
    const keeper = keeperId ? getLivePlayer(keeperId) : null;
    if (keeper && isMisActive(keeper) && keeper.current_zone === zoneId) {
      const msgs = await addHorniness(keeper, gain, () => {});
      sendToPlayer(keeper.id, { type: 'resource_tick', messages: msgs, player_update: { horniness: keeper.horniness, erect: keeper.erect, sanity: keeper.sanity } });
    }
    if (i >= thread.length) { sceneZones.delete(zoneId); return; }
    setTimeout(() => step().catch(() => {}), randInt(SCENE_TURN_MS[0], SCENE_TURN_MS[1]));
  };
  step().catch(() => {});
}

// ── Two-hander banter (a PAIRING only) ──────────────────────────────────────────
// Each thread is an ordered list of [who, line] turns; who is 'A' or 'B', resolved
// to the two members of a pairing standing in the room (pairIn). Same render
// convention as chitchat. PRIVATE threads play when it's just the two of them (their
// life, each other, the one they're both waiting on); WITH_KEEPER threads play when
// he's in the cabin and they perform their devotion — some of it aimed at him.
const PAIR_PRIVATE = [
  [
    ['B', `"He's not back yet." She says it to the porthole, not to §other.`],
    ['A', `"He's back when he's back. Sit down, §other — you'll wear a track in the carpet."`],
    ['B', `"You watch that door same as me. Don't pretend you don't."`],
    ['A', `a small, caught smile. "...I watch it a little."`],
  ],
  [
    ['A', `stretches out along the silk and sighs. "Do you ever think about before? Before the boat?"`],
    ['B', `"Every day. Then I look around at all this and I stop thinking about it."`],
    ['A', `"That's the trick of it, isn't it. He makes the before very easy to forget."`],
  ],
  [
    ['B', `"Brush my hair? I can never reach the back the way you do."`],
    ['A', `settles behind her and works the tangles out slow. "Hold still. You're always squirming."`],
    ['B', `"It's nice. Nobody did this, before you."`],
  ],
  [
    ['A', `"You took the last of the good wine again."`],
    ['B', `grins, unrepentant. "I left you the bottle he likes. That's practically a love letter."`],
  ],
  [
    ['B', `"If it were only ever the two of us out here — would that be so bad?"`],
    ['A', `quiet a moment. "It's never only the two of us. But I know what you mean."`],
  ],
  [
    ['A', `"You're humming that song again."`],
    ['B', `"It's stuck. It's been stuck since the harbour." She hums it anyway, softer.`],
  ],
  [
    ['B', `paints a second coat on her toes and holds a foot out. "Honest opinion. Too much?"`],
    ['A', `considers it like it's a matter of state. "For anyone else, yes. For you, exactly enough."`],
    ['B', `wiggles the toes, satisfied. "That's why I ask you and not the mirror."`],
  ],
  [
    ['A', `"Do you think he'd notice if we rearranged the whole cabin while he's out?"`],
    ['B', `"He notices when you move one cushion. He won't say anything. He'll just... look at it."`],
    ['A', `laughs. "The look. God, the look. Fine, the cushion stays."`],
  ],
  [
    ['B', `curls up small on the chaise. "What do you think we'd be, if none of this had happened?"`],
    ['A', `quiet a while. "Cold, probably. Hungry. Somewhere with worse light." She tucks the throw round them both. "Don't do that to yourself."`],
  ],
  [
    ['A', `"You fell asleep mid-sentence last night. Again."`],
    ['B', `unbothered. "I was comfortable. That's a compliment to the company." She stretches. "What was I saying?"`],
    ['A', `"No idea. Something about the stars. You were very moved about it."`],
  ],
];
const PAIR_WITH_KEEPER = [
  [
    ['B', `sits up the instant the hatch opens. "There he is. §other — he's home."`],
    ['A', `already crossing the cabin. "We kept it warm for you. We always keep it warm."`],
  ],
  [
    ['B', `"He looked at you first this time. I'm keeping score, you know."`],
    ['A', `"You keep a terrible score. He looked at the door — I was just standing in front of it."`],
    ['B', `laughs. "Same thing, on this boat."`],
  ],
  [
    ['A', `"Can we get you anything? You only have to say it. You barely have to say it."`],
    ['B', `"She means she'll fetch it. I'll supervise. It's a whole system."`],
  ],
  [
    ['B', `curls a little closer, eyes on him. "Stay in tonight. Let the sea handle the rest of them."`],
    ['A', `"She's right. There's nothing out there we can't be for you in here."`],
  ],
  [
    ['A', `"Tell us where you sailed today. §other pretends she doesn't listen, but she memorises every word."`],
    ['B', `doesn't look up from the porthole. "I do not." A beat. "...it was the northern channel, though, wasn't it."`],
  ],
  [
    ['A', `"He's got that crease between his eyebrows again, §other."`],
    ['B', `already moving. "I see it. I've got the shoulders, you've got the rest. Come here, you — sit."`],
  ],
  [
    ['B', `"§other learned your coffee. The real way, not the way the galley does it."`],
    ['A', `"It took me a week and I will not be humble about it. Sit. Let me ruin every other cup you'll ever have."`],
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
// Resolve 'A'/'B' to the two members of a PAIRING present in the room, and play
// turn by turn, re-checking both are still there and someone's still watching
// before every line. Each line is rendered for its speaker — pronouns to that
// consort's sex, and the §other slot to whichever of the two isn't talking.
function playScene(zoneId, a, b, thread) {
  sceneZones.add(zoneId);
  let i = 0;
  const step = () => {
    const bothHere = a && b && !a._dead && !b._dead
      && a.zone_id === zoneId && b.zone_id === zoneId;
    if (i >= thread.length || !bothHere || !getZonePlayers(zoneId).length) {
      sceneZones.delete(zoneId);
      return;
    }
    const [who, line] = thread[i++];
    const speaker = who === 'B' ? b : a;
    const other   = who === 'B' ? a : b;
    sendToZone(zoneId, formatChitchat(speaker.name, renderLine(line, speaker, { other: other.name })));
    const now = Date.now();
    lastSpoke.set(a.id, now);
    lastSpoke.set(b.id, now);
    if (speaker._ai) speaker._ai.lastSay = now;
    if (i >= thread.length) { sceneZones.delete(zoneId); return; }
    setTimeout(step, randInt(SCENE_TURN_MS[0], SCENE_TURN_MS[1]));
  };
  step();
}

// The two halves of a PAIRING standing in this room, in stable member order, or
// null if there isn't a complete pair here. This is what replaced looking up the
// names "roxy" and "bijou": a pairing is identified by flags.consort_pairing (a
// B.L.I.S.S. placement) or, for authored set-pieces, by both consorts declaring
// the same flags.consort_pairing key from the PAIRINGS registry. Two unrelated
// consorts in the same room are NOT a pair and never run two-handers together.
function pairIn(consorts, zoneId) {
  const here = consorts.filter(n => n.zone_id === zoneId && !n._dead && !n._combatTargetId);
  const byPairing = new Map();
  for (const n of here) {
    const key = n.flags?.consort_pairing;
    if (!key) continue;
    if (!byPairing.has(key)) byPairing.set(key, []);
    byPairing.get(key).push(n);
  }
  for (const members of byPairing.values()) {
    if (members.length < 2) continue;
    // Stable A/B order. The pairing KEY may be an authored registry name or a
    // generated uuid (a B.L.I.S.S. placement), so we don't parse it — we match the
    // two archetypes present against the PAIRINGS registry and take its member
    // order. That way a thread written for A always lands on the same personality
    // whichever way round the two were spawned.
    const kinds = members.map(m => m.flags?.consort_archetype);
    const entry = Object.values(PAIRINGS).find(p =>
      p.members.length === 2 && p.members.every(k => kinds.includes(k)));
    if (entry) {
      const a = members.find(m => m.flags?.consort_archetype === entry.members[0]);
      const b = members.find(m => m.flags?.consort_archetype === entry.members[1] && m !== a);
      if (a && b) return [a, b];
    }
    return [members[0], members[1]];
  }
  return null;
}

// ── The one beat that waits on him: "settle it" ─────────────────────────────────
// Both of them, keeper present, they stage a mock-argument about which he likes best
// and then actually make him answer OUT LOUD. The tick arms it (plays the setup, then
// hands the room back and starts a timer); the `player.say` hook below reads his reply
// and both of them react to the name he chose — or to his dodge, or to his silence.
const SETTLE_TIMEOUT_MS = 90_000;                 // how long they'll wait on an answer
const pendingSettle = new Map();                  // keeperId -> { zoneId, aId, bId, timer }

const SETTLE_SETUP = [
  ['B', `"We had an argument today about which of us you like best."`],
  ['A', `"There was no argument. I won." A beat. "...it was a draw. We're calling it a draw."`],
  ['B', `leans in, eyes bright and merciless. "So settle it — out loud, a name. Whole evenings ride on this. Well?"`],
];
const SETTLE_REACT = {
  a: [
    ['A', `doesn't gloat. She simply lets a slow, satisfied smile arrive and stay. "...noted. For the record."`],
    ['B', `clutches her chest like she's been shot. "BETRAYED. In my own cabin. §other, don't you DARE look smug—"`],
    ['A', `looking thoroughly smug. "I would never."`],
  ],
  b: [
    ['B', `lights up like the whole deck came on at once. "ME. He said ME — §other, are you hearing this—"`],
    ['A', `dry as the good gin. "The entire harbour's hearing it, §other." A pause, softer. "...good taste, though. I'll allow it."`],
  ],
  both: [
    ['A', `"Both of us. The diplomat's answer." She almost approves. "Cowardly. Effective. Very you."`],
    ['B', `"He can't choose because he's SMART. Take notes, §other." She's delighted either way.`],
  ],
  dodge: [
    ['B', `pouts to her full capacity. "That is not a name. That is a dodge. I know a dodge — I invented the dodge."`],
    ['A', `"Leave him be. The non-answer IS the answer, and it's the kind one." She doesn't look entirely certain she believes that.`],
  ],
  timeout: [
    ['B', `waits, and waits, and finally throws up her hands. "He's not going to say it. He never says it."`],
    ['A', `"That's your answer, then. He keeps us both guessing on purpose." A wry look at him. "Clever man."`],
  ],
};

const bothPresentWith = (zoneId, a, b, keeper) =>
  a && b && !a._dead && !b._dead
  && a.zone_id === zoneId && b.zone_id === zoneId
  && keeper && keeper.current_zone === zoneId;

function clearSettle(keeperId) {
  const p = pendingSettle.get(keeperId);
  if (p?.timer) clearTimeout(p.timer);
  pendingSettle.delete(keeperId);
}

// Which reaction the keeper's spoken reply earns: one of the two names, a "both of
// you", or a non-answer. The names are whoever is actually standing there — the
// old version tested for the literal strings "roxy" and "bijou", which is exactly
// the bug that made this beat unreachable the moment a consort was renamed.
function classifySettle(text, nameA = '', nameB = '') {
  const lower = ` ${String(text || '').toLowerCase()} `;
  const escape = (n) => String(n).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = (n) => !!n && new RegExp(`\\b${escape(n)}\\b`).test(lower);
  const saysA = named(nameA);
  const saysB = named(nameB);
  if ((saysA && saysB)
      || /\b(both|the two of you|you two|can'?t choose|won'?t choose|not choosing|equally|a draw|it'?s a tie|no favou?rite|love you both)\b/.test(lower)) return 'both';
  if (saysA) return 'a';
  if (saysB) return 'b';
  return 'dodge';
}

// Play the setup two-hander, then arm the question and let the room go quiet on him.
function playSettleQuestion(zoneId, a, b, keeper) {
  sceneZones.add(zoneId);
  let i = 0;
  const step = () => {
    if (!bothPresentWith(zoneId, a, b, keeper) || !getZonePlayers(zoneId).length) {
      sceneZones.delete(zoneId);
      return;
    }
    if (i < SETTLE_SETUP.length) {
      const [who, line] = SETTLE_SETUP[i++];
      const speaker = who === 'B' ? b : a;
      const other   = who === 'B' ? a : b;
      sendToZone(zoneId, formatChitchat(speaker.name, renderLine(line, speaker, { other: other.name })));
      const now = Date.now();
      lastSpoke.set(a.id, now);
      lastSpoke.set(b.id, now);
      setTimeout(step, randInt(SCENE_TURN_MS[0], SCENE_TURN_MS[1]));
      return;
    }
    sceneZones.delete(zoneId);                    // hand the room back; now we wait on him
    clearSettle(keeper.id);
    const timer = setTimeout(() => {
      pendingSettle.delete(keeper.id);
      if (bothPresentWith(zoneId, a, b, keeper) && getZonePlayers(zoneId).length)
        playScene(zoneId, a, b, SETTLE_REACT.timeout);
    }, SETTLE_TIMEOUT_MS);
    pendingSettle.set(keeper.id, { zoneId, aId: a.id, bId: b.id, timer });
  };
  step();
}

// The keeper answers with `say`. Resolve any pending question for him: parse the name
// he chose and let both of them react. A no-longer-valid room (they've moved, he's
// moved) just clears silently.
function onPlayerSay({ player, text }) {
  if (!player) return;
  const p = pendingSettle.get(player.id);
  if (!p) return;
  const a = world.npcs.get(p.aId);
  const b = world.npcs.get(p.bId);
  clearSettle(player.id);
  if (!bothPresentWith(p.zoneId, a, b, player)) return;
  const key = classifySettle(text, a.name, b.name);
  // Let his own say line land first, then they react.
  setTimeout(() => {
    if (bothPresentWith(p.zoneId, a, b, player) && getZonePlayers(p.zoneId).length)
      playScene(p.zoneId, a, b, SETTLE_REACT[key]);
  }, 900);
}

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

// Deck two-handers — pairing banter keyed to where they're beckoned, played the
// same way as the cabin scenes but out in the open (tame; the public deck isn't the
// place they come undone). Rare and long-gapped like every other beat.
const AREA_BANTER = {
  sundeck: [
    [
      ['B', `sinks into the jacuzzi opposite §other. "He built a boat with a hot tub on the roof. For us. Do you ever just... stop and think about that?"`],
      ['A', `"I try not to. If I think about it too hard I start crying into very expensive water."`],
    ],
    [
      ['A', `flicks a little water at §other across the froth. "You're hogging the good jet again."`],
      ['B', `"I found it first. Possession is nine tenths." She does not move. "You can share it. If you're nice."`],
      ['A', `raises an eyebrow, and slides over. "...I can be nice."`],
    ],
    [
      ['B', `oils her shoulders on the lounger and holds the bottle out. "Do my back? §other always misses a bit on purpose."`],
      ['A', `"I do not." A beat. "I miss it so he has to finish the job. That's strategy, not laziness."`],
      ['B', `laughs. "See, this is exactly why he keeps us both."`],
    ],
    [
      ['A', `stretches out gold with sun oil and sighs. "If the harbour could see us now."`],
      ['B', `"The harbour can see us now. That's a camera drone." She waves at it, lazy and unbothered.`],
    ],
  ],
  view: [
    [
      ['B', `"I could watch this water all night."`],
      ['A', `settles in beside her. "You say that, and then you're asleep on my shoulder in twenty minutes."`],
      ['B', `"...and you let me. Every time."`],
    ],
    [
      ['A', `"Name that constellation."`],
      ['B', `squints. "That one's 'The Big Expensive Boat.' And that one's 'The Two Girls Who Live On It.'"`],
      ['A', `"...I can't fault your astronomy."`],
    ],
  ],
  helipad: [
    [
      ['B', `throws her arms wide into the wind. "I'm the queen of the entire sky, §other!"`],
      ['A', `hangs back by the rail, laughing. "You're going to be the queen of the entire Basin if you lean any further."`],
      ['B', `"You'd catch me."`],
      ['A', `"...I'd catch you."`],
    ],
  ],
  cabin: [
    [
      ['B', `"Bet you can't guess which room he's in without looking."`],
      ['A', `doesn't hesitate. "Bridge. He's always the bridge before dinner." A beat. "Am I right?"`],
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
  npc._misHorny = 0;
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
        const pair = pairIn(consorts, zoneId);
        const pool = AREA_BANTER[areaProfile(zone)];
        if (pair && pool?.length) {
          sceneAt.set(zoneId, now);
          playScene(zoneId, pair[0], pair[1], pick(pool));
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
            const worriedLine = say(npc, voiceOf(npc).worried, companionFor(npc, zoneId));
            if (worriedLine) sendToZone(zoneId, formatChitchat(npc.name, worriedLine));
            lastSpoke.set(npc.id, now);
          }
          continue;                                                   // no arousal/undress while he's hurt
        }

        // Arousal only ever climbs when they're ALONE with the one they belong to.
        // A stranger in the room — even with him present — kills it. How far it climbs
        // this session is capped by the mood she rolled when she first warmed up, so
        // she doesn't strip every single time.
        // Absence bookkeeping. While he's in the room we keep stamping the clock;
        // the moment he's back after a gap worth remarking on, we arm the greeting.
        // Leaving re-arms it, so every return is its own reunion.
        if (keeperHere) {
          const gap = now - (npc._lastSeenKeeper || now);
          if (gap >= ABSENCE_SHORT_MS && !npc._absenceGreeted) npc._pendingAbsence = gap;
          npc._lastSeenKeeper = now;
        } else {
          npc._absenceGreeted = 0;
        }

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
        // Mirror onto the MIS transient so the mis plugin's threesome detector sees a
        // warmed-up consort as an eligible joiner when the keeper fucks the other one.
        npc._misHorny = a; npc._misHornyAt = now;

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

        // Fully bare and warm with him, between the bigger scenes she plays with
        // herself — unhurried, a whole variety of it. Filler beat; skips if she's
        // due for a scene or spoke too recently.
        if (keeperHere && !strangerHere && layers.length && (npc._clothingPeeled || 0) >= layers.length
            && !sceneZones.has(zoneId)
            && now - (lastSpoke.get(npc.id) || 0) >= SPEAK_GAP_MS && Math.random() < 0.4) {
          const [tame, hot] = pick(NAKED_SOLO);
          tieredZoneLine(zoneId, tame.replaceAll('§', npc.name), hot.replaceAll('§', npc.name));
          lastSpoke.set(npc.id, now);
          continue;
        }

        // Consort ⇄ consort. Another one here, BOTH of them warm enough, and their
        // attention lands on each other rather than on the keeper. Deliberately its
        // own branch ahead of the keeper acts, on a lower threshold: this is where a
        // warm evening goes before it peaks. Unlike the keeper acts it does NOT care
        // what sex the keeper is — he isn't in it — only that someone's watching, and
        // MIS decides what that someone sees. Paired or not.
        if (!strangerHere && !sceneZones.has(zoneId) && a >= MUTUAL_AT
            && now - (sceneAt.get(zoneId) || 0) > SCENE_GAP_MS
            && Math.random() < MUTUAL_CHANCE) {
          const partner = getZoneNpcs(zoneId).find(n =>
            isConsort(n) && n.id !== npc.id && !n._dead && !n._combatTargetId
            && n.zone_id === zoneId && (arousal.get(n.id) || 0) >= MUTUAL_AT);
          if (partner) {
            const m = mutualFor(npc, partner);
            if (m?.pool?.length) {
              sceneAt.set(zoneId, now);
              playKeeperScene(zoneId, pick(m.pool), { A: m.A, B: m.B }, keeper?.id || null, 12);
              break;                                             // the scene owns the room this tick
            }
          }
        }

        // Signature acts — their expertise. Peaked, alone with the keeper, MIS on:
        // they start something unbidden. A multi-beat, MIS-tiered, timed scene (it
        // raises the keeper's arousal) on the same long cooldown as the two-handers,
        // sometimes solo, sometimes both at once. The KEEPER'S SEX is not a gate —
        // it selects which half of the act matrix plays.
        if (keeperHere && !strangerHere && a >= FELLATIO_AT
            && isMisActive(keeper)
            && !sceneZones.has(zoneId)
            && now - (sceneAt.get(zoneId) || 0) > SCENE_GAP_MS
            && Math.random() < FELLATIO_CHANCE) {
          sceneAt.set(zoneId, now);
          const pair = pairIn(consorts, zoneId);
          const act = KEEPER_ACTS[pick(Object.keys(KEEPER_ACTS))];
          // Threads come from [keeper sex][consort sex]. The duo set only exists for
          // a same-sex pair, so a mixed pairing falls through to whichever of the two
          // is running this beat.
          const duo = pair && Math.random() < FELLATIO_DUO_CHANCE ? actDuoFor(act, pair[0], pair[1], keeper) : null;
          if (duo) {
            playKeeperScene(zoneId, pick(duo), { A: pair[0], B: pair[1] }, keeper.id, act.gain);
          } else {
            const solo = actSoloFor(act, npc, keeper);
            if (solo) playKeeperScene(zoneId, pick(solo), { A: npc }, keeper.id, act.gain);
          }
          break;                                                 // the scene owns the room this tick
        }

        // Spoken beats — throttled, and sometimes she just is, quietly.
        if (now - (lastSpoke.get(npc.id) || 0) < SPEAK_GAP_MS) continue;

        // Two-hander: private only, both of them here, on a long cooldown.
        if (!strangerHere && !sceneZones.has(zoneId)
            && now - (sceneAt.get(zoneId) || 0) > SCENE_GAP_MS
            && Math.random() < SCENE_CHANCE) {
          const pair = pairIn(consorts, zoneId);
          if (pair) {
            sceneAt.set(zoneId, now);
            // Sometimes, with him here, they don't just perform — they make him answer.
            if (keeperHere && keeper && !pendingSettle.has(keeper.id) && Math.random() < SETTLE_CHANCE) {
              playSettleQuestion(zoneId, pair[0], pair[1], keeper);
            } else {
              playScene(zoneId, pair[0], pair[1], pick(keeperHere ? PAIR_WITH_KEEPER : PAIR_PRIVATE));
            }
            break;                                               // the scene owns the room this tick
          }
        }

        if (Math.random() > SPEAK_CHANCE) continue;

        // Solo beat: shy to a stranger; devoted (tier by arousal) to the keeper alone.
        // Each consort speaks in her own register (voiceOf).
        const V = voiceOf(npc);
        const companion = companionFor(npc, zoneId);

        // Co-presence: another consort here who ISN'T their pairing. They don't share
        // the two-hander threads — those assume a history these two don't have — but
        // they do notice each other, and the reaction depends on both their sexes.
        // Only when the room is private: in front of a stranger the shy register wins.
        if (companion && !arePaired(npc, companion) && !strangerHere
            && Math.random() < CO_PRESENCE_CHANCE) {
          const pool = coPresenceFor(npc, companion);
          if (pool) {
            const [tame, hot] = pick(pool);
            const fill = (l) => renderLine(l, npc, { other: companion.name });
            tieredZoneLine(zoneId, fill(tame), fill(hot));
            lastSpoke.set(npc.id, now);
            continue;
          }
        }
        if (strangerHere) {
          const line = say(npc, V.shy, companion);
          if (line) { sendToZone(zoneId, formatChitchat(npc.name, line)); lastSpoke.set(npc.id, now); }
        } else if (keeperHere) {
          const hot = isMisActive(keeper);
          // How long he's been away colours the FIRST warm beat after he's back —
          // see the absence model above. After that it's the usual devotion pools.
          const absence = absenceTierFor(npc, keeper, now);
          const pool = absence ? V[absence]
            : a >= AROUSED_AT ? (hot ? V.arousedHot : V.arousedTame)
                              : (hot ? V.devotedHot : V.devotedTame);
          const line = say(npc, pool, companion);
          if (line) { sendToZone(zoneId, formatChitchat(npc.name, line)); lastSpoke.set(npc.id, now); }
          if (absence) npc._absenceGreeted = now;
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
      return { type: 'dialogue', npcId: npc.id, npcName: npc.name, node: 'root', text: rendered.text, options: rendered.options, stage: rendered.stage, mood: rendered.mood };
    }
  }

  // Falls back to the shared pools only if an archetype somehow carries none —
  // every registered one does, and regress asserts it.
  const V = voiceOf(npc);
  const line = isKeeper
    ? say(npc, V.talkKeeper?.length ? V.talkKeeper : TALK_TO_KEEPER)
    : say(npc, V.talkShy?.length ? V.talkShy : TALK_SHY);
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

// Arrival / departure narration. From a room the boudoir opens onto they come
// through the concealed wardrobe; called anywhere else they simply make their way
// over. The pool comes from their ARCHETYPE, so a Strategist arrives composed and
// unhurried while a Romantic arrives headlong — beckoning two never prints the same
// beat twice, and it keeps working when the consort is a randomly-named placement
// nobody has ever written a line for. `§` → their name.
function pickEntrance(npc, kind, viaWardrobe) {
  const table = archetypeOf(npc).entrances;
  const pool = table[`${kind}${viaWardrobe ? 'Wardrobe' : 'Deck'}`] || table.arriveDeck;
  return renderLine(pick(pool), npc);
}

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
    const line = pickEntrance(npc, 'arrive', viaWardrobe);
    narrateToRoom(dest, player.id, line, line);
    moveEntity(npc, dest, NOOP, query);                            // silent hop; we narrate it
    lines.push(line);
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
    const line = pickEntrance(npc, 'depart', npc.zone_id === emergeZoneOf(npc));
    tieredZoneLine(npc.zone_id, line, line);
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
  'player.say': (payload) => { try { onPlayerSay(payload); } catch (e) { console.error('[consort] onPlayerSay:', e.message); } return undefined; },
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

  // Strip filler; what's left can name a consort ("pour Vesper") and/or a drink
  // ("pour me a whiskey"), in any order ("vesper pour me a whiskey"). Match token by
  // token so a name and a drink in the same request both land.
  const wantTokens = args.join(' ')
    .replace(/\b(pour|me|a|an|the|some|one|please|drink|glass|of)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase().split(' ').filter(Boolean);
  let npc = pick(pool);
  let drinkId = pick(bar.drinks);
  if (wantTokens.length) {
    const named = pool.find(n => wantTokens.some(t => String(n.name || '').toLowerCase().includes(t)));
    if (named) npc = named;
    const wanted = bar.drinks.find(id => wantTokens.some(t => String(getItem(id)?.name || '').toLowerCase().includes(t)));
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
  const tameLine = renderLine(pick(V.pourTame)(dp), npc);
  const line = isMisActive(player) ? renderLine(pick(V.pourHot)(dp), npc) : tameLine;
  const othersMsg = formatChitchat(npc.name, tameLine).message;
  for (const p of getZonePlayers(player.current_zone)) {
    if (p.id !== player.id) sendToPlayer(p.id, { type: 'zone_event', message: othersMsg });
  }
  return { type: 'output', message: formatChitchat(npc.name, line).message };
}

// ── Direct commands to a present consort ─────────────────────────────────────────
// The keeper addresses one of his consorts by name and tells her what he wants:
//   vesper suck me   ·   calla ride me   ·   sable handjob   ·   wren pour me a whiskey
// A name-prefixed input matcher with a NARROW verb list — it never matches the
// second word of another multi-word verb ("eat out …", "jerk off on …"), so it
// can't shadow them. Anything whose first word isn't one of HIS present consorts
// returns undefined and falls through to normal command routing.
// Verbs map onto the ROLE keys in KEEPER_ACTS, not onto an anatomy — "suck me" and
// "lick me" are the same request, and what it turns into depends on who's asking.
// `lick`/`eat` are safe additions because the matcher is name-prefixed: "eat" alone
// still belongs to the food verb, only "vesper eat me" reaches here.
const CONSORT_DIRECT_RE = /^([a-z]+),?\s+(suck|blow|blowjob|bj|head|lick|eat|go|ride|mount|fuck|sex|screw|handjob|hj|stroke|finger|pour|kiss)\b/i;
const DIRECT_ACT = {
  suck: 'oral', blow: 'oral', blowjob: 'oral', bj: 'oral', head: 'oral',
  lick: 'oral', eat: 'oral', go: 'oral',
  ride: 'ride', mount: 'ride', fuck: 'ride', sex: 'ride', screw: 'ride',
  handjob: 'hand', hj: 'hand', stroke: 'hand', finger: 'hand',
};

// Start a commanded act on the keeper right now — no arousal gate, he asked for it.
// Warms her up, then runs the same timed keeper-scene the auto path uses.
function startCommandedAct(npc, keeper, actKey) {
  const zoneId = keeper.current_zone;
  if (sceneZones.has(zoneId)) return { type: 'output', message: `${npc.name} is already busy with you.` };
  const act = KEEPER_ACTS[actKey];
  if (!act) return undefined;
  if (!isMisActive(keeper)) return { type: 'output', message: `${npc.name} laughs softly and keeps it to a kiss on the cheek.` };
  sceneAt.set(zoneId, Date.now());
  arousal.set(npc.id, Math.max(arousal.get(npc.id) || 0, AROUSED_AT));
  npc._misHorny = Math.max(npc._misHorny || 0, AROUSED_AT); npc._misHornyAt = Date.now();
  const solo = actSoloFor(act, npc, keeper);
  if (!solo) return { type: 'output', message: `${npc.name} gives you a look and lets it go at that.` };
  playKeeperScene(zoneId, pick(solo), { A: npc }, keeper.id, act.gain);
  return { type: 'output', message: `${npc.name} doesn't need telling twice.` };
}

async function cmdConsortDirect(args, raw, player, broadcast) {
  const m = raw.match(CONSORT_DIRECT_RE);
  if (!m) return undefined;
  const nameWord = m[1].toLowerCase();
  const verb = m[2].toLowerCase();
  const here = getZoneNpcs(player.current_zone).filter(n => isConsort(n) && n.flags?.devoted_to === player.handle);
  if (!here.length) return undefined;
  const npc = here.find(n => String(n.name || '').toLowerCase().startsWith(nameWord))
           || here.find(n => String(n.name || '').toLowerCase().includes(nameWord));
  if (!npc) return undefined;   // not one of his consorts → let normal routing have it

  if (verb === 'pour') return cmdPour([npc.name, ...raw.split(/\s+/).slice(2)], raw, player);
  if (verb === 'kiss') {
    tieredZoneLine(player.current_zone,
      `${npc.name} leans in and kisses you, soft and unhurried.`,
      `${npc.name} kisses you deep, one hand curling at the back of your neck.`);
    return { type: 'output', message: `You pull ${npc.name} in and kiss her.` };
  }
  return startCommandedAct(npc, player, DIRECT_ACT[verb] || 'oral');
}

registerInputMatcher(CONSORT_DIRECT_RE, cmdConsortDirect, 'consort');

export const commands = {
  beckon:  cmdBeckon,
  dismiss: cmdDismiss,
  pour:    cmdPour,
};

// ── Boot ────────────────────────────────────────────────────────────────────────
// Put every retained consort back in their billet. Plugins load after the world
// (server/index.js), so world.zones is populated by the time this runs. These NPCs
// exist ONLY in memory — the player_consorts ledger is their persistence, and they
// are deliberately never `npcs` rows (see hire.js for why).
rehydrateConsorts().catch(e => console.error('[consort] boot rehydrate:', e.message));

// Exposed for the regress suite.
export const _test = {
  isConsort, peeledForArousal, onTalk, consortTick,
  PAIR_PRIVATE, PAIR_WITH_KEEPER, arousal, moodCap, lastSpoke,
  rollMoodCap, PEEL_HOT, BARE_HOT,
  FELLATIO_SOLO, FELLATIO_DUO, FELLATIO_AT,
  RIDE_SOLO, RIDE_DUO, HANDJOB_SOLO, KEEPER_ACTS, NAKED_SOLO,
  FELLATIO_SOLO_M, FELLATIO_DUO_M, RIDE_SOLO_M, RIDE_DUO_M, HANDJOB_SOLO_M,
  actSoloFor, actDuoFor, sexOf, keeperSexOf,
  ORAL_F_SOLO_F, ORAL_F_SOLO_M, ORAL_F_DUO_F, ORAL_F_DUO_M,
  RIDE_F_SOLO_F, RIDE_F_SOLO_M, RIDE_F_DUO_F, RIDE_F_DUO_M,
  HAND_F_SOLO_F, HAND_F_SOLO_M,
  CO_PRESENCE, coPresenceFor, arePaired, CO_PRESENCE_CHANCE,
  MUTUAL_FF, MUTUAL_MM, MUTUAL_MIXED, mutualFor, MUTUAL_AT, MUTUAL_CHANCE,
  cmdConsortDirect, startCommandedAct, DIRECT_ACT, CONSORT_DIRECT_RE,
  voiceOf,
  MAX_AROUSAL, AROUSED_AT,
  consortsOf, cmdBeckon, cmdDismiss, cmdPour, barIn, retreatConsorts,
  areaProfile, isIntimateZone, runAreaActivity, AREA_ACTIVITIES, ACT_MIN_MS,
  AREA_BANTER, onFurnitureDescribe,
  pickEntrance, pairIn, say, companionFor, absenceTierFor,
  SETTLE_SETUP, SETTLE_REACT, classifySettle, onPlayerSay, pendingSettle, clearSettle,
};
