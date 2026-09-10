/**
 * NPC drugs — offensive dosing of NPCs, the counterpart to the player-only drug
 * system. Players already buy/sell to NPC dealers; this makes NPCs *subjects* of
 * drugs, not just the counterparty.
 *
 * Three delivery verbs, one shared core (`doseNpc`):
 *   • spike <npc> [with <drug>]   — covert. A Deception check (Cool+Brains) vs the
 *                                    room. Success doses them unaware and draws NO
 *                                    heat; failure = they notice → assault heat.
 *   • jab <npc> [with <drug>]     — forced needle. Always lands, always assault heat.
 *   • slip <drug> to <npc>        — willing hand-off. Only NPCs who use drugs
 *                                    (flags.uses_drugs) or an already-loosened NPC
 *                                    take it; consensual, no heat. This is the seam
 *                                    the future addict-customer economy grows into.
 *
 * The EFFECT comes from `drugs.flags.drug_class` — the same pharmacological field
 * drugs.js already keys the polydrug ceiling, cross-tolerance and withdrawal
 * substitution off, so the NPC reaction agrees with the rest of the game rather
 * than inventing a second taxonomy out of stat deltas:
 *   stimulant    → 'wired'        jittery, agitated, talks over you
 *   nootropic    → 'lucid'        unnervingly precise, finished sentences
 *   cannabis     → 'mellow'       slow, amiable, in no hurry
 *   psychedelic  → 'tripping'     absorbed, delighted, talking to the room
 *   dissociative → 'dissociated'  upright and awake but a long way back; graph yielded
 *   deliriant    → 'paranoid'     the blind-panic flee
 *   depressant / opioid → 'sedated'
 *     1-4 doses→ 'loose'  (glassy, pacified, blurts candid lines — still upright,
 *                            still running its own graph)
 *     5+ doses→ 'out'     (BLACKOUT: setPosture lying + ai.dosedOut). Deliberately
 *                            far out — drunk and incapacitated are different states.
 * An unclassed drug (a crafted compound, a legal consumable) falls back to the old
 * hallucination/reflexes derivation, so nothing without a class regresses.
 *
 * State is runtime-only on the live NPC's AI blackboard (`npc._ai.dose`) — never a
 * DB write (the no-new-npc-columns rule; NPC rows are uncached). A reboot sobers
 * everyone. The engine reacts to exactly one plugin-set boolean, `ai.dosedOut`,
 * the same "plugin owns the state, engine yields the graph" contract burglary uses
 * with `ai.alarm` and posture uses with `player.posture`. The seam is one line in
 * tickEntityAI; expiry, flee steps and flavour are driven by this plugin's own tick.
 */
import { query } from '../../server/models/db.js';
import { world, getZoneNpcs, getZone, getZonePlayers, getNpcsByFlag, hasActivePlayers } from '../../server/engine/world.js';
import { schedule } from '../../server/engine/scheduler.js';
import { getDrugCache } from '../../server/engine/drugs.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { setPosture, forceStand } from '../../server/engine/posture.js';
import { moveEntity } from '../../server/engine/ai-behaviour.js';
import { neighborZoneIds } from '../../server/engine/exits.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
import { effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { on, emit } from '../../server/engine/events.js';
import { npcNextShiftInMins } from '../../server/engine/broadcast-bridge.js';
import { getTimeScale } from '../../server/engine/gametime.js';
import { getEnvironmentState } from '../../server/engine/environment.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
const SEDATE_MS     = 90000;   // a downer runs ~90s on an NPC
// How many sedative doses before an NPC stops functioning entirely. This is the
// BLACKOUT threshold, not the drunk threshold — everything below it is `loose`:
// glassy, candid, slower, but upright and still running its own behaviour graph.
//
// Was 2, which made "drunk" and "unconscious" almost the same event and meant a
// couple of drinks put a working NPC on the floor for the rest of their shift.
// Getting a person to the point of losing motor control takes real, sustained
// effort, and it should here too: five doses is a determined campaign, not a
// round. Raising it also widens the interesting middle — the long stretch where
// someone is impaired and still absolutely insisting they're fine.
const SEDATE_OUT_DOSES = 5;
const PARANOID_MS   = 60000;   // a bad trip ~60s
const WIRED_MS      = 60000;   // a stimulant jag ~60s
// A psychedelic outlasts a line of anything — that is most of what makes it a
// different decision. A dissociative hole is shorter and much stranger, and being
// stoned sits somewhere in between and never really ends, it just wears off.
const TRIPPING_MS     = 180000;
const DISSOCIATED_MS  = 45000;
const MELLOW_MS       = 120000;
const SPIKE_DC      = 6;       // Deception difficulty for a clean covert spike

// ── State ───────────────────────────────────────────────────────────────────
const DOSED = new Set();       // npcIds currently carrying an effect (drives the tick)

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const roll2d8 = () => Math.floor(Math.random() * 8) + 1 + Math.floor(Math.random() * 8) + 1;
const err = (message) => ({ type: 'error', message });
const out = (message) => ({ type: 'output', message });
const fleeBroadcast = (zoneId, payload, excludeId) => sendToZone(zoneId, payload, excludeId);

// ── Effect classification (from the drug's own data — no content edits) ────────
//
// `flags.drug_family` is the ANSWER when it's there: what KIND of drug this is,
// pharmacologically, as authored content.
//
// It matters because the derivation below is COARSE — it can only see "does this
// hallucinate" and "does this raise reflexes", which collapses ketamine, nitrous,
// mushrooms and a screaming deliriant terror into one bucket called `paranoid`,
// and everything that isn't an upper into `sedated`. Family lets a dissociative go
// blank and far away, a psychedelic be absorbed and delighted, and only a genuine
// deliriant produce the blind-panic flee.
//
// ⚠ `drug_family` IS NOT `drug_class`, and conflating them is the trap. `drug_class`
// means one specific thing — "this kills by ADDITIVE LOAD" — and drives the shared
// polydrug overdose ceiling, cross-tolerance and withdrawal substitution in
// drugs.js. Only `depressant` and `stimulant` carry it, and psychedelics are
// deliberately excluded (docs/systems-survival.md): they are dangerous in other
// ways but they don't stop your breathing by stacking. Describing the whole
// pharmacopoeia through that field would silently hand every psychedelic a shared
// overdose ceiling nobody asked for. So: family DESCRIBES, class KILLS.
//
// `drug_class` is still read as a fallback, because a depressant is a depressant
// and there is no sense making anyone author both.
const CLASS_KIND = {
  stimulant:    'wired',
  nootropic:    'lucid',
  depressant:   'sedated',
  opioid:       'sedated',
  cannabis:     'mellow',
  psychedelic:  'tripping',
  dissociative: 'dissociated',
  deliriant:    'paranoid',
};

function classify(effects, flags) {
  const byFamily = CLASS_KIND[flags?.drug_family] || CLASS_KIND[flags?.drug_class];
  if (byFamily) return byFamily;
  // No family and no class (a crafted compound, whose effects vary per mix): fall
  // back to the original derivation so nothing unauthored regresses.
  const eff = effects || {};
  if (eff.hallucination) return 'paranoid';
  const peak = eff.phases?.peak_mods || {};
  const inst = eff.instant || {};
  if ((peak.stat_reflexes || 0) > 0 || (inst.stamina || 0) > 0) return 'wired';
  return 'sedated';
}

// ── Flavour ───────────────────────────────────────────────────────────────────
const LINE = {
  loose:    (n) => `${n}'s eyes go glassy and the wary edge slides right off them.`,
  out:      (n) => `${n}'s knees fold — they slump bonelessly to the floor and don't get up.`,
  paranoid: (n) => `${n}'s pupils blow wide; they flinch at nothing and start scanning the room like the walls just moved.`,
  wired:    (n) => `${n}'s jaw starts working overtime, one heel jackhammering the floor, eyes too bright.`,
  belligerent: (n) => `${n}'s eyes go flat and mean. Whatever they were before the drink, this is what was underneath it.`,
  // The four that used to be crushed into paranoid/sedated for want of a class.
  mellow:      (n) => `${n} settles about an inch lower into themselves, and stops being in any particular hurry.`,
  tripping:    (n) => `${n} stops mid-motion, looks at something ordinary as though they have never seen one before, and smiles.`,
  dissociated: (n) => `${n} goes very still. Whatever is behind their eyes has stepped back a long way from the front.`,
  lucid:       (n) => `${n}'s gaze sharpens to a point, and they start speaking in complete, finished sentences.`,
};
const LOOSE_MUTTER = [
  (n) => `${n} mumbles something they'd never say sober, then loses the thread.`,
  (n) => `${n} leans in far too close and starts oversharing.`,
  (n) => `${n} giggles at nothing and lets half a secret slip before trailing off.`,
];
const OUT_MUTTER  = [(n) => `${n} sprawls where they fell, breathing slow and heavy.`];

// ── The mean drunk ────────────────────────────────────────────────────────────
//
// Derived from personality, not a flag: who turns nasty on a skinful is a fact
// about the person, and the cast already declares who it is. Nothing to author —
// tag an NPC `thug` and they were always going to be like this.
//
// Deliberately a MINORITY of the roster. Vendors, doctors, preachers and clerks
// stay maudlin, because a world where every drunk swings is a world with no bars
// in it. The list is people whose job or life already runs on the threat of
// violence, plus the ones with nothing left to lose.
const MEAN_DRUNK_PERSONALITIES = new Set([
  'thug', 'mercenary', 'lowlife', 'guard', 'labourer', 'gambler', 'dealer', 'vagrant',
]);
const isMeanDrunk = (npc) => MEAN_DRUNK_PERSONALITIES.has(String(npc?.flags?.personality || ''));

const BELLIGERENT_MUTTER = [
  (n) => `${n} squares up to nobody in particular and mutters a challenge at the room.`,
  (n) => `${n} looks you up and down like they're pricing a fight.`,
  (n) => `${n} knocks something off a surface and dares anyone to mention it.`,
  (n) => `${n} says "say that again" to a room in which nobody has said anything.`,
];
const SCUFFLE_LINES = [
  (a, b) => `${a} shoves ${b} hard in the chest and calls them something unrepeatable.`,
  (a, b) => `${a} swings a wild, drunken haymaker at ${b} and mostly connects.`,
  (a, b) => `${a} gets a fistful of ${b}'s collar before anyone can step between them.`,
  (a, b) => `${a} headbutts ${b} with more enthusiasm than accuracy.`,
];
const SCUFFLE_END = [
  (a, b) => `${a} and ${b} are dragged apart, both insisting they're fine.`,
  (a, b) => `${a} loses interest in ${b} halfway through a sentence and wanders off.`,
];
// Per 4s tick, once belligerent. Low on purpose: the state is mostly TALK, and a
// fight should feel like an escalation you watched coming, not a dice roll that
// happens the second someone gets a drink in them.
const BELLIGERENT_PICK_FIGHT = 0.012;
const BRAWL_MS = 24000;             // a scrap runs ~24s, then gets broken up
const SCUFFLE_FLOOR_HP = 12;        // never scuffle an NPC below this, or toward death
const WIRED_MUTTER = [
  (n) => `${n} grinds their teeth and mutters too fast to follow.`,
  (n) => `${n} paces a tight, twitchy circle, can't seem to stop moving.`,
];
const MELLOW_MUTTER = [
  (n) => `${n} laughs at something that finished a while ago.`,
  (n) => `${n} considers the ceiling with enormous patience.`,
  (n) => `${n} starts a sentence, forgets it, and doesn't mind at all.`,
  (n) => `${n} announces they're starving, and does nothing whatsoever about it.`,
];
const TRIPPING_MUTTER = [
  (n) => `${n} runs a hand along the wall, watching where their fingers have been.`,
  (n) => `${n} says something to the room that the room doesn't answer.`,
  (n) => `${n} watches the floor breathe, entirely unbothered that it's doing so.`,
  (n) => `${n} tries to explain something enormous, gets three words in, and gives up laughing.`,
];
const DISSOCIATED_MUTTER = [
  (n) => `${n} is looking at you, but from somewhere considerably further away than this room.`,
  (n) => `${n} moves one arm slowly, as though it belongs to somebody they used to know.`,
  (n) => `${n} answers a question nobody asked, about four seconds late.`,
  (n) => `${n} blinks once, very slowly, and doesn't seem to arrive at the end of it.`,
];
const LUCID_MUTTER = [
  (n) => `${n} finishes a thought out loud with unnerving precision.`,
  (n) => `${n} corrects something you didn't say wrong, politely and exactly.`,
  (n) => `${n} recites a list of something from memory, apparently for their own benefit.`,
];
const SOBER = {
  sedated:     (n) => `${n} drags in a breath, blinks hard, and slowly comes back to themselves.`,
  paranoid:    (n) => `${n} shudders, and whatever they were seeing loses its colour. They're back.`,
  wired:       (n) => `${n} crashes hard, shoulders sagging as the jitters drain out.`,
  mellow:      (n) => `${n} straightens up, rejoins the day, and looks mildly disappointed about it.`,
  tripping:    (n) => `${n} watches the last of it drain out of the walls, and comes back looking older.`,
  dissociated: (n) => `${n} arrives back behind their own eyes all at once, and flinches at the distance.`,
  lucid:       (n) => `${n}'s focus lets go, and the sentences go back to the ordinary shape.`,
};

// ── The shared core: apply an effect to a live NPC ─────────────────────────────
// `opts` lets a CALLER own the length and chattiness of a dose without changing
// what any other dose does. The pre-show ritual is the only user: it runs for
// game-hours rather than the flat 60s a player's hit gives, and has to whisper
// rather than mutter or it would talk over its own broadcast. Everything else
// passes nothing and behaves exactly as before.
function doseNpc(npc, kind, drugName, opts = {}) {
  const ai = npc._ai || (npc._ai = {});
  const d = ai.dose || (ai.dose = { doses: 0 });
  d.kind = kind;                    // last dose wins on kind
  d.doses += 1;
  d.drugName = drugName;
  const now = Date.now();

  // Reset the sub-flags each dose; set the ones this kind needs.
  d.loose = d.out = d.flee = d.wired = d.belligerent = false;
  d.mellow = d.tripping = d.dissociated = d.lucid = false;
  d.mutterChance = opts.mutterChance ?? null;

  if (kind === 'sedated') {
    d.until = now + (opts.durationMs || SEDATE_MS);
    // `neverOut` is the belt to SEDATE_OUT_DOSES' braces, and it exists because
    // blacking out sets ai.dosedOut, which makes the engine YIELD THE BEHAVIOUR
    // GRAPH — including GO_TO_WORK. An NPC whose own habit could floor them would
    // quietly stop turning up for their job, which is a different character than
    // the one intended. A habit passes this; a player working someone up to five
    // doses does not, so deliberately putting an NPC down still works as before.
    if (d.doses >= SEDATE_OUT_DOSES && !opts.neverOut) {
      d.out = true;
      ai.dosedOut = true;                              // engine yields the graph
      try { setPosture(npc, 'lying'); } catch { /* posture best-effort */ }
      sendToZone(npc.zone_id, { type: 'zone_event', message: LINE.out(npc.name) });
    } else if (isMeanDrunk(npc)) {
      // Same dose, different person. A mean drunk is still `loose` for everything
      // that reads that flag (candid, impaired) — belligerence rides ON TOP rather
      // than replacing it, so nothing downstream has to learn a new state.
      d.loose = true;
      d.belligerent = true;
      sendToZone(npc.zone_id, { type: 'zone_event', message: LINE.belligerent(npc.name) });
    } else {
      d.loose = true;
      sendToZone(npc.zone_id, { type: 'zone_event', message: LINE.loose(npc.name) });
    }
  } else if (kind === 'paranoid') {
    d.until = now + PARANOID_MS;
    d.flee = true;
    ai.dosedOut = true;                                // suppress graph; we drive the flee
    sendToZone(npc.zone_id, { type: 'zone_event', message: LINE.paranoid(npc.name) });
  } else if (kind === 'dissociated') {
    // Absent rather than asleep. The graph is suppressed — a dissociated NPC does
    // not run errands — but unlike `out` they are UPRIGHT and awake, so no posture
    // change and nothing about them says "loot me".
    d.until = now + (opts.durationMs || DISSOCIATED_MS);
    d.dissociated = true;
    ai.dosedOut = true;
    sendToZone(npc.zone_id, { type: 'zone_event', message: LINE.dissociated(npc.name) });
  } else if (kind === 'tripping' || kind === 'mellow' || kind === 'lucid') {
    // All three keep running their own behaviour graph. That is the whole point of
    // splitting them off `paranoid`: being high is not the same as being seized.
    d.until = now + (opts.durationMs || (kind === 'mellow' ? MELLOW_MS : TRIPPING_MS));
    d[kind] = true;
    sendToZone(npc.zone_id, { type: 'zone_event', message: LINE[kind](npc.name) });
  } else { // wired
    d.until = now + (opts.durationMs || WIRED_MS);
    d.wired = true;
    sendToZone(npc.zone_id, { type: 'zone_event', message: LINE.wired(npc.name) });
  }
  DOSED.add(npc.id);
}

// ── After ─────────────────────────────────────────────────────────────────────
//
// Coming down is not the same as never having taken it, and this is the half that
// makes an NPC's habit read as a habit rather than a costume they put on for a
// minute. For a while after the effect ends they are visibly the worse for it,
// and — for stimulants — they CRASH: `ai.crashSleepy` is a timestamp the engine's
// AT_HOME_LIFE reads to make going to bed much likelier than usual.
//
// That flag is the whole cross-system point. One plugin-owned field, one engine
// read, same contract as `ai.dosedOut`: the drug taken at eight o'clock is why
// they're face down at eleven, and you can watch the whole arc.
const COMEDOWN_MINS      = [45, 90];        // GAME minutes of visible aftermath
const COMEDOWN_MUTTER    = 0.05;
const COMEDOWN = new Set();                 // npcIds in the aftermath (drives the same tick)

const COMEDOWN_LINES = {
  sedated: [
    (n) => `${n} moves like everything weighs more than it did an hour ago.`,
    (n) => `${n} winces at the light and swears quietly at nobody.`,
    (n) => `${n} drinks a lot of water very fast and looks no better for it.`,
  ],
  wired: [
    (n) => `${n}'s hands won't quite settle. They keep finding things to hold.`,
    (n) => `${n} stops mid-sentence, loses it entirely, and doesn't go back for it.`,
    (n) => `${n} rubs their jaw, grey around the eyes, running on nothing at all.`,
  ],
  paranoid: [
    (n) => `${n} keeps glancing at the corners of the room, checking they've stayed corners.`,
    (n) => `${n} flinches at a sound nobody else reacted to, then pretends they didn't.`,
  ],
  tripping: [
    (n) => `${n} keeps catching movement at the edge of things and turning to find nothing.`,
    (n) => `${n} is quiet in the particular way of someone still sorting out what that was.`,
  ],
  dissociated: [
    (n) => `${n} keeps checking their own hands, as if confirming the arrangement.`,
    (n) => `${n} loses a couple of seconds mid-sentence and picks it up slightly wrong.`,
  ],
  mellow: [
    (n) => `${n} eats something with total, unhurried attention.`,
    (n) => `${n} yawns hugely and shows no interest in anything being asked of them.`,
  ],
  lucid: [
    (n) => `${n} rubs their eyes, and the sentences come apart a little at the ends.`,
  ],
};

// Return the NPC to its normal AI: clear the effect, stand it up, restart the graph.
function sober(npc) {
  DOSED.delete(npc.id);
  const ai = npc._ai;
  const kind = ai?.dose?.kind || 'sedated';
  const wasDown = !!(ai?.dose?.out || ai?.dose?.flee);
  if (ai) {
    ai.dose = null;
    ai.dosedOut = false;
    ai.currentNode = null;      // mirror burglary's endAlarm: graph resumes from _start
    ai.waitUntil = 0;
    // The aftermath. Real ms derived from game minutes, same as every dose length
    // here, so it can't drift when the world clock is retuned.
    const gameMins = COMEDOWN_MINS[0] + Math.random() * (COMEDOWN_MINS[1] - COMEDOWN_MINS[0]);
    const untilMs = Date.now() + (gameMins * 60 * 1000) / Math.max(1, getTimeScale());
    ai.comedown = { kind, until: untilMs };
    if (kind === 'wired') ai.crashSleepy = untilMs;   // engine reads this in AT_HOME_LIFE
    COMEDOWN.add(npc.id);
  }
  if (wasDown) { try { forceStand(npc); } catch { /* best-effort */ } }
  sendToZone(npc.zone_id, { type: 'zone_event', message: (SOBER[kind] || SOBER.sedated)(npc.name) });
}

// One blind-panic flee step toward a random neighbour; cower if boxed in.
function stepFlee(npc) {
  const zone = getZone(npc.zone_id);
  const neighbors = zone ? neighborZoneIds(zone).filter(Boolean) : [];
  if (!neighbors.length) {
    if (Math.random() < 0.5)
      sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} presses into a corner, warding off things that aren't there.` });
    return;
  }
  sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} bolts in a blind panic!` });
  moveEntity(npc, pick(neighbors), fleeBroadcast, query);
}

// ── Picking a fight ───────────────────────────────────────────────────────────
//
// Two very different mechanisms, deliberately, because the two targets are not
// comparable.
//
// AGAINST A PLAYER — hand off to the real combat engine. Setting `_combatTargetId`
// is the entire hook: gameLoop's NPC-retaliation pass already picks that up every
// tick and runs npcAttackPlayer, with real to-hit, real armour, real damage and
// real death. The player can fight back, flee, or call it in. Nothing new is
// needed and nothing about combat is reimplemented here.
//
// AGAINST ANOTHER NPC — a self-contained scuffle, NOT the combat engine. There is
// no npcAttackNpc (only enemyAttackNpc, which takes a spawned enemy instance), and
// inventing full NPC-vs-NPC combat for a bar fight would be a large, load-bearing
// engine change for a piece of flavour. Two NPCs neither side controls do not need
// to-hit rolls; they need to look like a fight and leave a mark. So this trades a
// few blows, takes a little HP, and stops well clear of killing anyone.
function scuffleTargets(npc) {
  const here = getZoneNpcs(npc.zone_id) || [];
  return here.filter(n => n && n.id !== npc.id && !n._dead
    && (n.hp == null || n.hp > SCUFFLE_FLOOR_HP)
    && !n._ai?.dosedOut                     // don't beat on someone already out cold
    && n.posture !== 'lying');
}

function pickAFight(npc) {
  // NPCs first: a drunk squares up to whoever is nearest, and starting on another
  // NPC keeps the escalation in the fiction rather than immediately on the player.
  const npcs = scuffleTargets(npc);
  if (npcs.length) {
    const foe = pick(npcs);
    sendToZone(npc.zone_id, { type: 'zone_event', message: pick(SCUFFLE_LINES)(npc.name, foe.name) });
    // Hand off to the real engine. `_brawlFloorHp` caps it: a drunken scrap
    // bruises and humiliates but must not put a body on the floor of a bar every
    // time someone has a skinful. Remove the floor and this is a killing.
    npc._brawlFloorHp = SCUFFLE_FLOOR_HP;
    npc._combatTargetId = foe.id;
    return true;
  }
  // Nobody else to swing at — turn on a player, through the real combat seam.
  const players = getZonePlayers(npc.zone_id) || [];
  const victim = players.find(p => p && !p.dead);
  if (!victim) return false;
  sendToZone(npc.zone_id, { type: 'zone_event',
    message: `${npc.name} decides, with the terrible clarity of the very drunk, that ${victim.handle} is the problem.` });
  npc._combatTargetId = victim.id;          // gameLoop takes it from here
  return true;
}

// ── Driver tick: flavour, flee, expiry (self-gates when nobody's dosed) ────────
function tick() {
  if (!DOSED.size && !COMEDOWN.size) return;
  const now = Date.now();

  // The aftermath pass — cheap, and separate from DOSED because an NPC on a
  // comedown is running their own graph normally again; this only adds flavour.
  for (const id of [...COMEDOWN]) {
    const npc = world.npcs.get(id);
    const cd = npc?._ai?.comedown;
    if (!npc || !cd || now >= cd.until) {
      COMEDOWN.delete(id);
      if (npc?._ai) { npc._ai.comedown = null; npc._ai.crashSleepy = 0; }
      continue;
    }
    if (npc._ai.homeSleeping || npc._ai.dosedOut) continue;   // already slept it off / out cold
    const pool = COMEDOWN_LINES[cd.kind] || COMEDOWN_LINES.sedated;
    if (Math.random() < COMEDOWN_MUTTER) sendToZone(npc.zone_id, { type: 'zone_event', message: pick(pool)(npc.name) });
  }

  for (const id of [...DOSED]) {
    const npc = world.npcs.get(id);
    if (!npc || !npc._ai?.dose) { DOSED.delete(id); continue; }
    if (npc.hp != null && npc.hp <= 0) { DOSED.delete(id); continue; }
    const d = npc._ai.dose;
    if (now >= d.until) { sober(npc); continue; }
    if (d.flee) { stepFlee(npc); continue; }
    if (d.out)   { if (Math.random() < 0.3) sendToZone(npc.zone_id, { type: 'zone_event', message: pick(OUT_MUTTER)(npc.name) }); continue; }
    if (d.belligerent) {
      // A brawl the engine is now running: let it go a few exchanges, then break
      // it up. Without this the two of them trade blows until one hits the floor
      // cap and they stand there swinging at each other forever.
      if (npc._combatTargetId && world.npcs.get(npc._combatTargetId)) {
        npc._brawlUntil = npc._brawlUntil || (now + BRAWL_MS);
        if (now >= npc._brawlUntil) {
          const foe = world.npcs.get(npc._combatTargetId);
          npc._combatTargetId = null; npc._brawlFloorHp = null; npc._brawlUntil = null;
          if (foe) { foe._combatTargetId = null; foe._brawlFloorHp = null; foe._brawlUntil = null; }
          if (foe) sendToZone(npc.zone_id, { type: 'zone_event', message: pick(SCUFFLE_END)(npc.name, foe.name) });
        }
      } else if (!npc._combatTargetId && Math.random() < BELLIGERENT_PICK_FIGHT) {
        pickAFight(npc);
      } else if (Math.random() < (d.mutterChance ?? 0.4)) {
        sendToZone(npc.zone_id, { type: 'zone_event', message: pick(BELLIGERENT_MUTTER)(npc.name) });
      }
      continue;
    }
    // Everything left runs its own graph and just talks. One table, so adding a
    // state is a row rather than another branch in here.
    const pool = d.loose ? LOOSE_MUTTER : d.wired ? WIRED_MUTTER
      : d.mellow ? MELLOW_MUTTER : d.tripping ? TRIPPING_MUTTER
      : d.dissociated ? DISSOCIATED_MUTTER : d.lucid ? LUCID_MUTTER : null;
    if (pool && Math.random() < (d.mutterChance ?? 0.4)) {
      sendToZone(npc.zone_id, { type: 'zone_event', message: pick(pool)(npc.name) });
    }
  }
}
schedule('4s', () => { try { tick(); } catch (e) { console.error('[npc-drugs] tick error:', e.message); } });

// ── Pre-show habit: an NPC's own vice ─────────────────────────────────────────
// Data-driven, not hardcoded to anyone: any NPC with flags.preshow_habit set to a
// drug name will *rarely* dose themselves at home, when a player is around to see
// it. It reads as a nervy pre-show ritual — the performer who can't go on flat —
// and applies the same effect the drug would (a stimulant → wired). The rarity is
// a long cooldown × a low per-scan roll × "only when watched," so it's a treat you
// stumble into, not a thing that's always happening.
// Timed off the SHOW, not off the observer. He doses about two hours out and is
// still up when the lights come on — which is the whole point of a pre-show
// habit, and it only reads as one if the audience can meet him already high.
//
// Everything here is in GAME minutes because the broadcast timetable is, and the
// dose length converts to real ms at the live time scale so the two can't drift
// apart when the world clock is retuned.
const PRESHOW_LEAD_MINS   = 120;            // game minutes before curtain
const PRESHOW_WINDOW_MINS = 25;             // how wide the "about two hours" band is
const PRESHOW_CHANCE      = 0.10;           // ...per SHOW, rolled once. Not per scan.
const PRESHOW_HIGH_MINS   = [300, 360];     // 5–6 game hours: covers the lead AND the show
// A long dose can't chatter at the ordinary rate — 40% per 4s tick for five hours
// would be a wall of text, and most of it would land on air. One tell every few
// minutes reads as a man holding it together; anything more reads as a bug.
const PRESHOW_MUTTER_CHANCE = 0.012;
// One roll per scheduled show, not per scan: the latch key is the slot the roll
// was made against, so a 10% chance means one show in ten rather than "10% every
// forty-five seconds until it happens", which is a certainty wearing a hat.
const preshowRolled = new Map();            // npcId -> latch key already rolled

// ── Taking it, as something you can watch ─────────────────────────────────────
//
// THE STANDARD, and every NPC habit in the game should go through it: an NPC
// never simply "is high". They fetch the thing, they prepare it, they take it,
// and only THEN does the effect land — three or four beats spaced a handful of
// seconds apart, so a player walking in mid-ritual sees a person making a choice
// rather than a status effect appearing on a body.
//
// Deliberately the same shape as ambient-life's home routines (narrate beats,
// re-validate before each one, no state, no writes) because it is the same kind
// of thing: nothing is simulated, and nobody can tell.
//
// Pronouns are they/them throughout — these pools are reused by any NPC carrying
// the flag, and a pool that says "his" is a pool that can only ever fit one man.
const RITUAL_BEAT_MS = [4500, 8000];

function runRitual(npc, beats, onDone) {
  const zoneId = npc.zone_id;
  let i = 0;
  const step = () => {
    // Re-validated every beat. Someone who is dragged into a fight, put on the
    // floor or moved mid-ritual doesn't finish it — and crucially never reaches
    // onDone, so the dose lands only if the act completed.
    const live = world.npcs.get(npc.id);
    if (!live || live._dead || (live.hp != null && live.hp <= 0)
        || live.zone_id !== zoneId || live._combatTargetId
        || live._ai?.homeSleeping || live._ai?.dosedOut) return;
    if (i < beats.length) {
      sendToZone(zoneId, { type: 'zone_event', message: `${live.name} ${beats[i++]}` });
      setTimeout(step, RITUAL_BEAT_MS[0] + Math.random() * (RITUAL_BEAT_MS[1] - RITUAL_BEAT_MS[0]));
      return;
    }
    onDone(live);
  };
  step();
}

const PRESHOW_RITUALS = [
  [`checks the countdown feed — "...live in ten" — and goes very still for a moment.`,
   `taps out a neat line of {drug} along the back of a hand mirror, with the ease of long habit.`,
   `takes it in one, blinks twice as the room sharpens to a razor's edge, and grins at their own reflection.`],
  [`digs a tin out from somewhere it wasn't supposed to be, and weighs it in one hand.`,
   `dabs a little {drug} onto their gums and works their jaw, waiting for it.`,
   `rolls their shoulders as it lands, and the pre-show nerves go out of them all at once.`],
  [`"Nobody tunes in for flat," they tell the empty room, entirely reasonably.`,
   `tips a hit of {drug} under their tongue and checks the time again.`,
   `does a quick, practised bump off the back of a hand, and is suddenly, brightly awake.`],
];

// The drink version of the same ritual. Somebody steadying themselves before the
// lights come on is the oldest version of this story, and it needs its own beats:
// tipping a hit of whisky under your tongue is not a thing anyone does.
const PRESHOW_DRINK_RITUALS = [
  [`checks the countdown feed — "...live in ten" — and goes very still for a moment.`,
   `pours two fingers of {drug} from a bottle that lives behind something else.`,
   `drinks it off, breathes out slowly, and squares their shoulders at the door.`],
  [`opens a drawer, considers it, and takes out the {drug} rather than whatever they went in for.`,
   `pours a measure, tops it up, and drinks it standing.`,
   `rinses the glass, puts it back exactly where it was, and is ready.`],
  [`"Nobody tunes in for flat," they tell the empty room, entirely reasonably.`,
   `knocks back a shot of {drug} and grimaces at their own reflection.`,
   `works their jaw, finds the smile, and holds it there until it fits.`],
];

function kindForNamed(name) {
  const d = Object.values(getDrugCache()).find(x => (x.name || '').toLowerCase() === String(name).toLowerCase());
  return d ? classify(d.effects, d.flags) : 'wired';   // an unrecognised DRUG name is an upper
}

/**
 * One pre-show pass for one flag.
 *
 * Two flags, mirroring the standing pair exactly, because the alternative is
 * guessing: a drink's name is authored flavour ("embassy reserve") and will never
 * be in the drugs catalogue, so `kindForNamed` would fall through to its
 * unrecognised-drug default and hand a broadcast anchor a stimulant jag off a
 * glass of whisky, narrated as a line off a hand mirror.
 *
 *   preshow_habit — a DRUG. Effect classified from the drug's own data.
 *   preshow_drink — a DRINK. Always sedated, and `neverOut`: an anchor who folds
 *                   before curtain doesn't make the broadcast, which is a
 *                   different character than the one intended.
 */
function preshowScan(flag, { rituals, kindFor, neverOut }) {
  // No longer gated on someone standing in the room — a habit that only happens
  // when watched isn't a habit. Still gated on the server having ANY players: an
  // empty world has nobody to ever see the consequence, and the engine's rule is
  // that scheduled ticks idle out (docs/architecture.md).
  if (!hasActivePlayers()) return;
  const npcs = getNpcsByFlag(flag);
  if (!npcs.length) return;
  for (const npc of npcs) {
    if (npc.hp != null && npc.hp <= 0) continue;
    if (DOSED.has(npc.id)) continue;                                   // already high
    if (npc._ai?.homeSleeping) continue;                               // asleep — it waits
    if (!npc.home_zone || npc.zone_id !== npc.home_zone) continue;     // they do this at home

    // How far out is curtain? null = staffed on nothing with a knowable start.
    const mins = npcNextShiftInMins(npc.id);
    if (mins == null || mins <= 0) continue;                           // no show, or already on
    if (Math.abs(mins - PRESHOW_LEAD_MINS) > PRESHOW_WINDOW_MINS) continue;

    // Latch on the SHOW, so the 10% is per show rather than per scan. The key is
    // curtain's absolute position on the game clock: as the scan repeats, `now`
    // rises by exactly what `mins` falls, so their sum is invariant for a given
    // slot and every scan inside the band derives the same key.
    //
    // Quantising the countdown instead — the obvious first attempt — silently
    // yields two keys as it crosses a bucket edge, which rolls twice and turns a
    // 10% chance into 19%.
    const { minutes, dayOfWeek } = getEnvironmentState();
    // Latch per FLAG as well as per NPC: someone who keeps both a bottle and a
    // baggie gets one roll each, not one roll shared between them.
    const key = `${flag}:${(dayOfWeek || 0) * 1440 + Math.round(minutes || 0) + mins}`;
    if (preshowRolled.get(`${npc.id}:${flag}`) === key) continue;
    preshowRolled.set(`${npc.id}:${flag}`, key);
    if (Math.random() >= PRESHOW_CHANCE) continue;

    const name = (typeof npc.flags[flag] === 'string' && npc.flags[flag]) ? npc.flags[flag] : 'something';
    // Deliberately broadcast whether or not anyone is standing there. An empty
    // room costs nothing, and gating on an audience made the ritual something
    // that only ever happened when watched — which is backwards for a habit.
    const gameMins = PRESHOW_HIGH_MINS[0] + Math.random() * (PRESHOW_HIGH_MINS[1] - PRESHOW_HIGH_MINS[0]);
    runRitual(npc, pick(rituals).map(b => b.replace('{drug}', name)), (live) => {
      doseNpc(live, kindFor(name), name, {
        durationMs: (gameMins * 60 * 1000) / Math.max(1, getTimeScale()),
        mutterChance: PRESHOW_MUTTER_CHANCE,
        neverOut,
      });
    });
  }
}

schedule('45s', () => {
  try {
    preshowScan('preshow_habit', { rituals: PRESHOW_RITUALS,       kindFor: kindForNamed, neverOut: false });
    preshowScan('preshow_drink', { rituals: PRESHOW_DRINK_RITUALS, kindFor: () => 'sedated', neverOut: true });
  } catch (e) { console.error('[npc-drugs] preshow error:', e.message); }
});

// ── The standing habit: an NPC who drinks on no schedule but their own ────────
//
// The other half of the pre-show ritual. That one is an occasion — twice a week,
// timed to a curtain. This is a DEPENDENCY: no lead-up, no trigger, just a
// cadence, and it does not care whether there's a show.
//
// `flags.booze_habit` = the drink's name. Any NPC can carry it; it happens to
// describe a broadcast host who is usually at his desk and usually not sober.
//
// Two deliberate differences from preshow:
//   • No schedule lookup, so it works for NPCs staffed on nothing.
//   • `neverOut` — see doseNpc. He gets loose, never floored, because an NPC who
//     collapses stops running their graph and stops turning up for work. "Often
//     drunk, still on air" is the character; "missing, face down at home" is not.
// There are two of these, sharing one scanner, because a bottle and a baggie are
// the same shape of behaviour with different nouns:
//   flags.booze_habit = "<drink name>"  — always sedated, never floored.
//   flags.drug_habit  = "<drug name>"   — effect derived from the drug's own data
//                                          (so a stimulant habit reads as wired),
//                                          and CAN put them under: a habit on the
//                                          hard stuff is supposed to be able to
//                                          cost them the evening.
const HABIT_COOLDOWN_MS = 20 * 60 * 1000;   // real ms between hits
const HABIT_CHANCE      = 0.35;             // per scan once the cooldown is clear
const BOOZE_DRUNK_MINS  = [120, 180];       // 2–3 GAME hours per drink
const DRUG_HIGH_MINS    = [90, 150];
const HABIT_MUTTER_CHANCE = 0.02;           // a slur now and then, not a monologue
const habitLast = new Map();                // `${npcId}:${flag}` -> ts of last hit

// ── How far he takes it, and you can watch him decide ────────────────────────
//
// A habit used to be ONE pour: the ritual played, the dose landed, and every night
// was identically bad. That is a status effect with a nice animation in front of it,
// not a man drinking — and it made the worst night of his life indistinguishable
// from an ordinary Tuesday.
//
// So the ritual is the FIRST pour and the night has a size. The extra ones are the
// same shape as the ritual (a visible beat, re-validated, in the room) because the
// whole point is that somebody standing there sees him go back to it. `doseNpc`
// already counts (`d.doses`) and already lets the last dose win on duration, so
// nothing new is stored — the ladder that was only reachable by force-feeding
// somebody is now reachable by a man on his own in a basement.
//
// Weighted so most nights are ordinary: the bad one has to be rare to read as bad.
const POUR_WEIGHTS = [0, 0, 0, 0, 1, 1, 2];     // extra pours beyond the ritual's
const POUR_GAP_MS  = [25000, 70000];            // real ms between them
const POUR_AGAIN = [
  `pours another without appearing to have decided to.`,
  `tops the glass up. There was no gap between the last one and this one.`,
  `refills, drinks half of it standing, and sits back down heavier.`,
  `holds the bottle up to the light, finds it emptier than expected, and pours anyway.`,
  `doesn't bother with the glass this time.`,
];

function keepPouring(npc, drinkName, extra, opts) {
  if (extra <= 0) return;
  const zoneId = npc.zone_id;
  let left = extra;
  const step = () => {
    // Same re-validation as the ritual, for the same reason: a man who has been
    // dragged into a fight, put on the floor or moved is not still pouring.
    const live = world.npcs.get(npc.id);
    if (!live || live._dead || (live.hp != null && live.hp <= 0)
        || live.zone_id !== zoneId || live._combatTargetId
        || live._ai?.homeSleeping || live._ai?.dosedOut) return;
    sendToZone(zoneId, { type: 'zone_event', message: `${live.name} ${pick(POUR_AGAIN)}` });
    doseNpc(live, 'sedated', drinkName, opts);
    if (--left > 0) setTimeout(step, POUR_GAP_MS[0] + Math.random() * (POUR_GAP_MS[1] - POUR_GAP_MS[0]));
  };
  setTimeout(step, POUR_GAP_MS[0] + Math.random() * (POUR_GAP_MS[1] - POUR_GAP_MS[0]));
}

const BOOZE_RITUALS = [
  [`reaches for the {drug} without looking, which tells you where it lives.`,
   `pours a measure with the steadiness of someone who has never once considered that it might be a problem.`,
   `drinks it off, breathes out, and pours the next one before the first has landed.`],
  [`finds a mug that hasn't held coffee in some years.`,
   `fills it most of the way with {drug} and drinks off half in one go.`],
  [`cracks the seal on a fresh bottle of {drug}, glances at the door, and pours anyway.`,
   `settles back with the glass and the particular calm of a problem deferred.`],
];
const DRUG_RITUALS = [
  [`goes through a drawer with the focus of someone looking for one specific thing.`,
   `sets out the {drug} and sorts it with small, practised movements.`,
   `takes it, sits back, and waits for the room to change.`],
  [`stops what they were doing, all at once, like a thought arrived.`,
   `measures out a hit of {drug}, hands not quite steady until they've started.`,
   `takes it and holds very still for a long moment.`],
  [`checks the door, checks it again, and decides the room is empty enough.`,
   `does the {drug} quickly, the way you do a thing you'd rather not be watched doing.`],
];

function habitScan(flag, { rituals, mins, kindFor, neverOut, drink }) {
  if (!hasActivePlayers()) return;
  const npcs = getNpcsByFlag(flag);
  if (!npcs.length) return;
  const now = Date.now();
  for (const npc of npcs) {
    if (npc.hp != null && npc.hp <= 0) continue;
    if (DOSED.has(npc.id)) continue;                                   // still going from the last one
    if (npc._ai?.homeSleeping) continue;                               // asleep — the habit waits
    if (npc._ai?.comedown) continue;                                   // still coming off the last one
    const key = `${npc.id}:${flag}`;
    if (now - (habitLast.get(key) || 0) < HABIT_COOLDOWN_MS) continue;
    if (Math.random() >= HABIT_CHANCE) continue;
    habitLast.set(key, now);
    const name = (typeof npc.flags[flag] === 'string' && npc.flags[flag]) ? npc.flags[flag] : 'something';
    const gameMins = mins[0] + Math.random() * (mins[1] - mins[0]);
    const opts = {
      durationMs: (gameMins * 60 * 1000) / Math.max(1, getTimeScale()),
      mutterChance: HABIT_MUTTER_CHANCE,
      neverOut,
    };
    runRitual(npc, pick(rituals).map(b => b.replace('{drug}', name)), (live) => {
      doseNpc(live, kindFor(name), name, opts);
      // A DRINK has a size; a hit does not. You measure a hit out — that IS the
      // ritual — and then it is taken and it is done. A bottle is open on the table
      // and the next one is a decision you make again in four minutes, so only the
      // drink columns go back to it.
      if (drink) keepPouring(live, name, pick(POUR_WEIGHTS), opts);
    });
  }
}

schedule('45s', () => {
  try {
    // He gets loose, never floored — an NPC who collapses stops running their
    // graph and stops turning up for work. "Often drunk, still on air" is the
    // character; "missing, face down at home" is not.
    habitScan('booze_habit', { rituals: BOOZE_RITUALS, mins: BOOZE_DRUNK_MINS, kindFor: () => 'sedated', neverOut: true, drink: true });
    habitScan('drug_habit',  { rituals: DRUG_RITUALS,  mins: DRUG_HIGH_MINS,   kindFor: kindForNamed, neverOut: false });
  } catch (e) { console.error('[npc-drugs] habit error:', e.message); }
});

// A killed/despawned NPC drops its effect so nothing lingers on a stale row.
on('npc.killed', ({ npc }) => {
  if (!npc) return;
  DOSED.delete(npc.id);
  COMEDOWN.delete(npc.id);
  if (npc._ai) { npc._ai.dose = null; npc._ai.dosedOut = false; npc._ai.comedown = null; npc._ai.crashSleepy = 0; }
});

// ── Talking to someone who is on something ────────────────────────────────────
// The other half of "it influences their behaviour from that point on": you can
// SEE it in the conversation. This never claims the conversation — it emits one
// tell to the room and returns undefined, so the dialogue tree, the shop and
// every plugin that wanted this NPC all run exactly as they did before.
const TALK_TELL = {
  loose:       (n) => `${n} takes a moment to find your face, and rather longer to find the words.`,
  belligerent: (n) => `${n} turns on you slowly, looking for something in the question to take badly.`,
  wired:       (n) => `${n} answers before you've finished, talking over the end of it.`,
  flee:        (n) => `${n} won't hold eye contact, and keeps checking the space behind you.`,
  out:         (n) => `${n} doesn't stir.`,
  comedown:    (n) => `${n} looks at you like conversation is one more thing being asked of them today.`,
  mellow:      (n) => `${n} takes their time getting round to you, and doesn't seem to think that's a problem.`,
  tripping:    (n) => `${n} hears you, eventually, from wherever they currently are.`,
  dissociated: (n) => `${n} turns their head toward you with the unhurried delay of a bad connection.`,
  lucid:       (n) => `${n} answers before you've finished, precisely, and is already waiting for the next one.`,
};

// Which single word describes what this NPC is currently on. Pure, and ordered
// most-incapacitated first so the tell always names the state that matters.
function doseState(ai, now = Date.now()) {
  if (!ai) return null;
  const d = ai.dose;
  if (d) {
    if (d.out) return 'out';
    if (d.flee) return 'flee';
    if (d.dissociated) return 'dissociated';
    if (d.belligerent) return 'belligerent';
    if (d.tripping) return 'tripping';
    if (d.wired) return 'wired';
    if (d.loose) return 'loose';
    if (d.mellow) return 'mellow';
    if (d.lucid) return 'lucid';
    return null;
  }
  return ai.comedown && now < ai.comedown.until ? 'comedown' : null;
}

function talkTell({ npc }) {
  const ai = npc?._ai;
  const state = doseState(ai);
  if (!state) return undefined;
  sendToZone(npc.zone_id, { type: 'zone_event', message: TALK_TELL[state](npc.name) });
  return undefined;                                  // never claims the conversation
}

export const hooks = {
  'npc.talk': (payload) => { try { return talkTell(payload); } catch { return undefined; } },
};

// ── Verb plumbing ─────────────────────────────────────────────────────────────

// Resolve a live NPC in the room by name (returns the live world object, not a copy).
function resolveNpc(who, player) {
  const pool = getZoneNpcs(player.current_zone).filter(n => n && (n.hp == null || n.hp > 0));
  if (!pool.length) return { type: 'none' };
  return siftResolve(who, pool);
}

// Find one carried drug (matching `name`, or the first drug carried if name is null).
async function findCarriedDrug(player, name) {
  const like = `%${(name || '').trim()}%`;
  const filter = name ? 'AND (i.name ILIKE $2 OR pi.custom_data->>\'name\' ILIKE $2)' : '';
  const params = name ? [player.id, like] : [player.id];
  const { rows } = await query(
    `SELECT pi.id AS inv_id, pi.quantity, pi.custom_data,
            i.id AS item_id, i.name AS item_name,
            d.effects, d.flags AS drug_flags, d.name AS drug_name
       FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
       JOIN drugs d ON d.item_id = i.id
      WHERE pi.player_id = $1 AND pi.container_id IS NULL AND pi.is_equipped = 0 ${filter}
      ORDER BY i.name LIMIT 1`,
    params
  );
  return rows[0] || null;
}

// Burn one dose from the stack.
async function consumeDose(row) {
  if (row.quantity <= 1) await query('DELETE FROM player_inventory WHERE id=$1', [row.inv_id]);
  else await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [row.inv_id]);
}

const drugDisplay = (row) => row.custom_data?.name || row.drug_name || row.item_name;

// Split "<npc> with <drug>" → { who, drug }. `with` is optional (drug auto-picks).
function parseTargetWith(args) {
  const toks = args.filter(Boolean);
  const wi = toks.findIndex(t => t.toLowerCase() === 'with');
  if (wi === -1) return { who: toks.join(' ').trim(), drug: null };
  return { who: toks.slice(0, wi).join(' ').trim(), drug: toks.slice(wi + 1).join(' ').trim() || null };
}

// Shared front half of spike/jab: resolve target + drug, or return an error object.
async function setup(args, player, verb) {
  const { who, drug } = parseTargetWith(args);
  if (!who) return { error: err(`Usage: ${verb} <someone> [with <drug>].`) };
  const r = resolveNpc(who, player);
  if (r.type === 'none') return { error: err(`There's no "${who || 'one'}" here to ${verb}.`) };
  if (r.type === 'ambiguous') return { error: err(`Who do you mean — ${r.candidates.map(c => c.name).join(', ')}?`) };
  const npc = r.candidate;
  const row = await findCarriedDrug(player, drug);
  if (!row) return { error: err(drug ? `You're not carrying a "${drug}".` : "You're not carrying anything to dose them with.") };
  return { npc, row, kind: classify(row.effects, row.drug_flags) };
}

// spike — covert. Deception vs the room; success = clean dose, failure = caught.
async function cmdSpike(args, raw, player) {
  const s = await setup(args, player, 'spike');
  if (s.error) return s.error;
  const { npc, row, kind } = s;
  const name = drugDisplay(row);

  const margin = (await effectiveSkill(player, 'deception')) - SPIKE_DC + (roll2d8() - roll2d8());
  await awardSkillUse(player.id, 'deception', margin);   // trains on success or near-miss

  if (margin < 0) {
    // Caught tipping it into their drink — assault-tier heat, no dose lands.
    emit('npc.attacked', { actor: player, npc });
    sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} knocks the ${name} aside — "What the hell did you just put in that?!"` }, player.id);
    return err(`${npc.name} catches you slipping the ${name} into their drink. Busted.`);
  }

  await consumeDose(row);
  doseNpc(npc, kind, name);
  return out(`You palm the ${name} into ${npc.name}'s drink, unseen.`);
}

// jab — forced needle. Always lands, always assault heat.
async function cmdJab(args, raw, player) {
  const s = await setup(args, player, 'jab');
  if (s.error) return s.error;
  const { npc, row, kind } = s;
  const name = drugDisplay(row);

  emit('npc.attacked', { actor: player, npc });          // it's an assault, in the open
  await consumeDose(row);
  sendToZone(npc.zone_id, { type: 'zone_event', message: `${player.handle} jams a dose of ${name} into ${npc.name}'s neck!` }, player.id);
  doseNpc(npc, kind, name);
  return out(`You jam the ${name} into ${npc.name}'s neck.`);
}

// slip — willing hand-off. Only a user (or an already-loosened mark) takes it.
async function cmdSlip(args, raw, player) {
  const toks = args.filter(Boolean);
  const ti = toks.findIndex(t => t.toLowerCase() === 'to');
  if (ti < 1) return err('Usage: slip <drug> to <someone>.');
  const drug = toks.slice(0, ti).join(' ').trim();
  const who = toks.slice(ti + 1).join(' ').trim();
  if (!drug || !who) return err('Usage: slip <drug> to <someone>.');

  const r = resolveNpc(who, player);
  if (r.type === 'none') return err(`There's no "${who}" here.`);
  if (r.type === 'ambiguous') return err(`Who do you mean — ${r.candidates.map(c => c.name).join(', ')}?`);
  const npc = r.candidate;

  const willing = !!(npc.flags?.uses_drugs || npc._ai?.dose?.loose);
  if (!willing) return err(`${npc.name} isn't interested, and waves you off.`);

  const row = await findCarriedDrug(player, drug);
  if (!row) return err(`You're not carrying a "${drug}".`);
  const name = drugDisplay(row);

  await consumeDose(row);
  sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} takes the ${name} from ${player.handle} without a second thought.` }, player.id);
  doseNpc(npc, classify(row.effects, row.drug_flags), name);
  return out(`You slip ${npc.name} the ${name}. They take it eagerly.`);
}

export const commands = {
  spike: cmdSpike,
  jab: cmdJab,
  slip: cmdSlip,
};

// Exposed for the regression suite (pure helpers — no side effects).
export const _test = {
  classify, parseTargetWith, doseState, TALK_TELL,
  kindForNamed, PRESHOW_RITUALS, PRESHOW_DRINK_RITUALS, BOOZE_RITUALS, DRUG_RITUALS,
  LINE, SOBER, CLASS_KIND,
  POUR_WEIGHTS, POUR_AGAIN, POUR_GAP_MS, keepPouring,
};

console.log('[npc-drugs] Plugin loaded.');
