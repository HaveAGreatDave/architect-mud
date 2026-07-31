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
 * The EFFECT is derived from the drug's existing data — no drug-content edits:
 *   effects.hallucination            → 'paranoid'  (panic + flee)
 *   stimulant signature (reflexes/stamina up) → 'wired'  (jittery, agitated)
 *   everything else (downers, alcohol, benzos, cannabis) → 'sedated'
 *     1-4 doses→ 'loose'  (glassy, pacified, blurts candid lines — still upright,
 *                            still running its own graph)
 *     5+ doses→ 'out'     (BLACKOUT: setPosture lying + ai.dosedOut). Deliberately
 *                            far out — drunk and incapacitated are different states.
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
const SPIKE_DC      = 6;       // Deception difficulty for a clean covert spike

// ── State ───────────────────────────────────────────────────────────────────
const DOSED = new Set();       // npcIds currently carrying an effect (drives the tick)

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const roll2d8 = () => Math.floor(Math.random() * 8) + 1 + Math.floor(Math.random() * 8) + 1;
const err = (message) => ({ type: 'error', message });
const out = (message) => ({ type: 'output', message });
const fleeBroadcast = (zoneId, payload, excludeId) => sendToZone(zoneId, payload, excludeId);

// ── Effect classification (from the drug's own data — no content edits) ────────
function classify(effects) {
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
const SOBER = {
  sedated:  (n) => `${n} drags in a breath, blinks hard, and slowly comes back to themselves.`,
  paranoid: (n) => `${n} shudders, and whatever they were seeing loses its colour. They're back.`,
  wired:    (n) => `${n} crashes hard, shoulders sagging as the jitters drain out.`,
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
  } else { // wired
    d.until = now + (opts.durationMs || WIRED_MS);
    d.wired = true;
    sendToZone(npc.zone_id, { type: 'zone_event', message: LINE.wired(npc.name) });
  }
  DOSED.add(npc.id);
}

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
  if (!DOSED.size) return;
  const now = Date.now();
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
    if (d.loose && Math.random() < (d.mutterChance ?? 0.4)) sendToZone(npc.zone_id, { type: 'zone_event', message: pick(LOOSE_MUTTER)(npc.name) });
    if (d.wired && Math.random() < (d.mutterChance ?? 0.4)) sendToZone(npc.zone_id, { type: 'zone_event', message: pick(WIRED_MUTTER)(npc.name) });
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
const PRESHOW_LINES = [
  `checks the countdown feed — "...live in ten" — and racks up a neat line of {drug} with the ease of long habit.`,
  `dabs a little {drug} onto his gums, blinks twice as the room sharpens to a razor's edge, and grins at his own reflection.`,
  `"Nobody tunes in for flat," he mutters, tipping a hit of {drug} under his tongue before the cameras roll.`,
  `does a quick, practised bump off the back of his hand, rolls his shoulders, and shakes out the pre-show nerves.`,
];

function kindForNamed(name) {
  const d = Object.values(getDrugCache()).find(x => (x.name || '').toLowerCase() === String(name).toLowerCase());
  return d ? classify(d.effects) : 'wired';   // pre-show default is an upper
}

function preshowScan() {
  // No longer gated on someone standing in the room — a habit that only happens
  // when watched isn't a habit. Still gated on the server having ANY players: an
  // empty world has nobody to ever see the consequence, and the engine's rule is
  // that scheduled ticks idle out (docs/architecture.md).
  if (!hasActivePlayers()) return;
  const npcs = getNpcsByFlag('preshow_habit');
  if (!npcs.length) return;
  for (const npc of npcs) {
    if (npc.hp != null && npc.hp <= 0) continue;
    if (DOSED.has(npc.id)) continue;                                   // already high
    if (!npc.home_zone || npc.zone_id !== npc.home_zone) continue;     // he does this at home

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
    const key = `${(dayOfWeek || 0) * 1440 + Math.round(minutes || 0) + mins}`;
    if (preshowRolled.get(npc.id) === key) continue;
    preshowRolled.set(npc.id, key);
    if (Math.random() >= PRESHOW_CHANCE) continue;

    const drugName = (typeof npc.flags.preshow_habit === 'string' && npc.flags.preshow_habit) ? npc.flags.preshow_habit : 'something';
    // Deliberately broadcast whether or not anyone is standing there. An empty
    // room costs nothing, and gating on an audience made the ritual something
    // that only ever happened when watched — which is backwards for a habit.
    sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} ${pick(PRESHOW_LINES).replace('{drug}', drugName)}` });
    const gameMins = PRESHOW_HIGH_MINS[0] + Math.random() * (PRESHOW_HIGH_MINS[1] - PRESHOW_HIGH_MINS[0]);
    doseNpc(npc, kindForNamed(drugName), drugName, {
      durationMs: (gameMins * 60 * 1000) / Math.max(1, getTimeScale()),
      mutterChance: PRESHOW_MUTTER_CHANCE,
    });
  }
}
schedule('45s', () => { try { preshowScan(); } catch (e) { console.error('[npc-drugs] preshow error:', e.message); } });

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
const BOOZE_COOLDOWN_MS = 20 * 60 * 1000;   // real ms between drinks
const BOOZE_CHANCE      = 0.35;             // per scan once the cooldown is clear
const BOOZE_DRUNK_MINS  = [120, 180];       // 2–3 GAME hours per drink
const BOOZE_MUTTER_CHANCE = 0.02;           // a slur now and then, not a monologue
const boozeLast = new Map();                // npcId -> ts of last drink
const BOOZE_LINES = [
  `pours a measure of {drug} with the steadiness of a man who has never once considered that it might be a problem.`,
  `tops up a mug that has not held coffee in some years, and drinks off half of it in one go.`,
  `cracks the seal on a fresh bottle of {drug}, glances at the door, and pours anyway.`,
  `drains the last of the {drug}, sets the glass down with exaggerated care, and immediately reaches for more.`,
];

function boozeScan() {
  if (!hasActivePlayers()) return;
  const npcs = getNpcsByFlag('booze_habit');
  if (!npcs.length) return;
  const now = Date.now();
  for (const npc of npcs) {
    if (npc.hp != null && npc.hp <= 0) continue;
    if (DOSED.has(npc.id)) continue;                                   // still going from the last one
    if (now - (boozeLast.get(npc.id) || 0) < BOOZE_COOLDOWN_MS) continue;
    if (Math.random() >= BOOZE_CHANCE) continue;
    boozeLast.set(npc.id, now);
    const drinkName = (typeof npc.flags.booze_habit === 'string' && npc.flags.booze_habit) ? npc.flags.booze_habit : 'something';
    sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} ${pick(BOOZE_LINES).replace('{drug}', drinkName)}` });
    const gameMins = BOOZE_DRUNK_MINS[0] + Math.random() * (BOOZE_DRUNK_MINS[1] - BOOZE_DRUNK_MINS[0]);
    doseNpc(npc, 'sedated', drinkName, {
      durationMs: (gameMins * 60 * 1000) / Math.max(1, getTimeScale()),
      mutterChance: BOOZE_MUTTER_CHANCE,
      neverOut: true,
    });
  }
}
schedule('45s', () => { try { boozeScan(); } catch (e) { console.error('[npc-drugs] booze error:', e.message); } });

// A killed/despawned NPC drops its effect so nothing lingers on a stale row.
on('npc.killed', ({ npc }) => {
  if (!npc || !DOSED.has(npc.id)) return;
  DOSED.delete(npc.id);
  if (npc._ai) { npc._ai.dose = null; npc._ai.dosedOut = false; }
});

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
            d.effects, d.name AS drug_name
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
  return { npc, row, kind: classify(row.effects) };
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
  doseNpc(npc, classify(row.effects), name);
  return out(`You slip ${npc.name} the ${name}. They take it eagerly.`);
}

export const commands = {
  spike: cmdSpike,
  jab: cmdJab,
  slip: cmdSlip,
};

// Exposed for the regression suite (pure helpers — no side effects).
export const _test = { classify, parseTargetWith };

console.log('[npc-drugs] Plugin loaded.');
