// THE LONG HAUL — the scale house.
//
// Phase 3, and the one idea in this whole system that is native to trucks rather than borrowed
// from somewhere else in the game.
//
// THE SCALE DETECTS WEIGHT, NOT CONTRABAND.
//
// Your manifest says the box holds 3,600 kg of scrap. The weighbridge says 4,400. It does not know
// what the other 800 is — it knows you lied. Everything interesting falls out of that one sentence:
//
//  • Detection keys off the DISCREPANCY, not off a tier lookup of what you are carrying. So the
//    counter-play is hauling less or declaring more, and both of those cost money. There is no
//    "smuggling skill" that makes a heavy trailer light.
//
//  • A LEGAL OVERWEIGHT LOAD FAILS THE SAME SCALE. Getting fined for honest greed and getting
//    caught smuggling are the same interaction, which is exactly the Cross Country Canada texture
//    and is the reason the rated capacity on a trailer means something.
//
//  • It is a decision you make BEFORE the inspection you know is coming. A scale you cannot see
//    ahead of you is a dice roll; one you can is a route choice.
//
// WHY IT IS NOT THE CHECKPOINT PLUGIN. `plugins/checkpoint/` is a `registerMoveGate` — it fires
// when a player WALKS onto a tile. A driver never walks: the rig moves through `driveToZone` and
// `crossToNode`, and the move gate is in fact registered to block walking entirely while driving.
// So the scale hangs off the drive, and the checkpoint config on Coldwater's yard still does its
// own job for a driver who has climbed down and is walking out with something in their coat. Two
// laws, two surfaces, no overlap: one weighs the TRAILER, the other searches the PERSON.
//
// THE ASYMMETRY IS ALREADY IN THE CONTENT. Buzzard Field is `lawless: true`, so the Reach end never
// scans. Coldwater→Reach is the smuggling run; Reach→Coldwater is the one where you sweat. That
// gradient costs nothing to honour and it is what makes the two directions different games.

import { sendToPlayer } from '../../server/engine/messaging.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { skillCheck } from '../../server/engine/skills.js';
import { query } from '../../server/models/db.js';
import { declaredKg, actualKg, stashKg } from './trailers.js';

// The tolerance a weighbridge will not bother with, and the slope past it. A scale that fired on
// 1 kg would make the whole system a tax rather than a decision.
const SLACK_KG = 150;
// How much discrepancy makes it a certainty. Below this it is a roll against the operator's
// attention, which is what `deception` is for — you are not hiding the weight, you are explaining it.
const CERTAIN_KG = 2500;
const BASE_DIFF = 4;

// The fine for being over, per kilo, whether you meant it or not.
const FINE_PER_KG = 1.4;

// A pending inspection, keyed by player. RAM only: it lives for the length of one conversation at a
// window, and a relog mid-inspection is a driver who drove off, which the game already models.
const pending = new Map();
export const pendingCustoms = (pid) => pending.get(pid) || null;
export const clearCustoms = (pid) => pending.delete(pid);

// Is this zone a scale house? Content decides, exactly as `truck_depot` does — the engine reads a
// flag and never knows which tiles have one.
export const scaleAt = (zone) => {
  const f = zone?.flags?.weigh_station;
  if (!f) return null;
  if (zone.flags?.lawless) return null;          // a lawless region does not run a scale
  return typeof f === 'object' ? f : { name: zone.name };
};

// The weighbridge itself. Returns null if there is nothing to answer for, or a pending inspection.
//
// NOTE the order: an EMPTY rig and a HONEST rig both pass, and they pass for the same reason —
// there is no discrepancy. Nothing about what you are carrying enters into it.
export async function runScale(player, rig, zone) {
  const cfg = scaleAt(zone);
  if (!cfg) return null;
  if (pending.has(player.id)) return null;                 // already at the window
  const t = rig.trailer;
  if (!t) return null;                                     // bobtail: nothing to weigh

  const declared = declaredKg(t);
  const actual = actualKg(t);
  const over = actual - declared;                          // undeclared weight
  const rated = t.ratedKg || 0;
  const overRated = Math.max(0, actual - t.kg - rated);    // legally overweight, declared or not

  if (over <= SLACK_KG && overRated <= SLACK_KG) {
    sendToPlayer(player.id, { type: 'output', message:
      `<span class="ambient">You roll onto the plates at ${cfg.name}. The board over the booth settles on a number that matches your paper, and the light goes green.</span>` });
    return null;
  }

  // The roll. Difficulty scales with how big the lie is; past CERTAIN_KG there is no roll at all,
  // because eight hundred kilos you cannot account for is not something you talk your way past.
  const gap = Math.max(over, overRated);
  const caught = gap >= CERTAIN_KG
    ? true
    : !(await skillCheck(player, 'deception', BASE_DIFF + Math.round((gap / CERTAIN_KG) * 8))).success;

  if (!caught) {
    sendToPlayer(player.id, { type: 'output', message:
      `<span class="ambient">The board reads high. You have a story about a wet load and a long night, and the operator has a shift ending in twenty minutes. The barrier goes up.</span>` });
    return null;
  }

  const inspection = {
    zoneId: zone.id, name: cfg.name,
    declared, actual, over, overRated,
    stash: (t.stash || []).slice(),
    fine: Math.round(overRated * FINE_PER_KG),
    at: Date.now(),
  };
  pending.set(player.id, inspection);
  rig.speed = 0;
  sendToPlayer(player.id, { type: 'emote', message: scaleText(inspection) });
  return inspection;
}

// THE ONE CALLSITE BOTH RUNGS USE. It lives here rather than in index.js because textdrive.js
// would then have to import index.js, which imports textdrive.js — and more importantly because
// "the two rungs must not become two games" is only true if the law is literally the same function.
// A text driver rolls onto the same plates.
export async function afterDrive(player, rig, zone) {
  if (!zone) return null;
  // ⚠ THE CAB FIRST, AND THEY ARE TWO DIFFERENT LAWS. See runCabCheck for why this is not folded
  // into the weighbridge, and why it runs even when there is nothing to weigh.
  await runCabCheck(player, rig, zone);
  return runScale(player, rig, zone);
}

// ── SOMEBODY LOOKS IN THE CAB ────────────────────────────────────────────────
//
// The hitchhiker design has always said it: riding in the sleeper is fast and free, and *anyone who
// looks in the cab finds them*. Nothing ever looked. Every path out of a hitcher — the payout, the
// dropoff, the scale — read the TRAILER, so a fugitive in the passenger seat was 400₵ at no risk at
// all and the sleeper/trailer fork had one obviously correct answer.
//
// ⚠ THIS IS NOT THE WEIGHBRIDGE, AND IT MUST NEVER BECOME IT. The one rule this whole building is
// built on is that the scale detects WEIGHT, NOT CONTRABAND — it compares your trailer against your
// paper and does not know what the difference is. Teaching it to recognise a person would collapse
// that into "the scale finds smuggled things", which is the generic checkpoint the scale house was
// deliberately designed not to be. So this is a separate law that happens to be enforced at the same
// gate: one weighs the box, one looks through the windscreen, and neither knows about the other.
// (The trailer rider is still caught by the SCALE, as eighty kilos that are not on the paper — which
// is the correct answer, arrived at without anybody knowing what the eighty kilos is.)
//
// ⚠ IT RUNS BOBTAIL. 'runScale' returns immediately with no trailer, which is right for a
// weighbridge and would have left the entire feature unreachable: a driver with nothing on the pin
// is never weighed, and a hitcher does not need a trailer.
//
// ⚠ AND THERE IS NO ROLL. Every other contest in this file is a skill check, and this one is
// deliberately not: the design's sentence is that anyone who looks FINDS them, and a Deception roll
// against an officer holding the door open makes that sentence a lie. The skill is in the decision
// a mile back — the trailer, or the other route, or not stopping. Once the door is open it is over.
// That is also what makes the trailer worth its eighty kilos.
//
// There is no bribe and no bolt here either, and their absence is the same argument. The three
// answers at the weighbridge exist because a discrepancy is ARGUABLE — a wet load, a long night. A
// person sitting in your bunk is not arguable, and offering to negotiate it would hand back the
// certainty that pays for the fork.
async function runCabCheck(player, rig, zone) {
  const cfg = scaleAt(zone);
  if (!cfg) return null;
  const who = rig?.rider;
  // Only the fugitive, and only in the seat. A mechanic in the passenger seat is a mechanic in the
  // passenger seat — giving somebody a lift is not a crime, and a check that stopped everybody
  // would make the other three kinds unpickable on any lawful road for no reason anybody could name.
  if (!who || who.inTrailer || who.id !== 'fugitive') return null;

  rig.rider = null;
  await dispatchAction({ type: 'CHARGE_CRIME', actor: player, params: { key: 'harbouring' } }).catch(() => {});
  sendToPlayer(player.id, { type: 'emote', message:
    `<span class="text-red">An officer walks the length of the rig at ${cfg.name}, puts a hand on the passenger door and opens it.</span>\n\n`
    + `There is nowhere in a cab to not be. They do not ask you anything — they are already talking to somebody on a radio, and your passenger is out of the seat and face down on the plates before you have finished stopping.\n\n`
    + `<span class="text-dim">Nobody says what they were wanted for. Nobody says it to you at all.</span>` });
  return { taken: true };
}

function scaleText(i) {
  const lines = [
    `<span class="text-amber">The board over the booth stops on <b>${Math.round(i.actual)} kg</b>. Your paper says <b>${Math.round(i.declared)} kg</b>.</span>`,
    '',
    'The barrier stays down. Somebody comes out of the booth with a slate and does not hurry.',
  ];
  if (i.over > SLACK_KG) {
    lines.push('', `"That's <b>${Math.round(i.over)} kilos</b> I can't see on this. I don't know what it is. I don't have to."`);
  } else {
    lines.push('', `"You're <b>${Math.round(i.overRated)} kilos</b> over your plate rating. That's a number, not an opinion."`);
  }
  lines.push('', `<span class="text-dim">${i.fine ? `A written fine would be ${i.fine}₵. ` : ''}<b>customs open</b> to let them look · <b>customs bribe</b> · <b>customs bolt</b></span>`);
  return lines.join('\n');
}

// ── The three answers ────────────────────────────────────────────────────────
// Lifted in shape from the Reach's proven customs fork, with the truck-native third option. Each
// one is a real trade rather than a better and worse version of the same thing:
//
//   open  — you eat the loss and you are NOT charged with a crime. Cheapest in stars, dearest in
//           goods. It is the option a professional takes, and it exists so that being caught is not
//           automatically a disaster.
//   bribe — money for silence, priced off the discrepancy so the big lie is the expensive one.
//           Fails against a clean operator, and failing is worse than opening.
//   bolt  — you run the scale. Free if you get away with it, a chase and a charge if you don't, and
//           it is the only one that touches the wanted system.
export async function customsAnswer(player, rig, what) {
  const i = pending.get(player.id);
  if (!i) return null;

  if (what === 'open') {
    pending.delete(player.id);
    const seized = i.stash.length;
    if (rig.trailer) { rig.trailer.stash = null; await saveStash(rig.trailer.id, null); }
    const fined = i.fine && (player.credits || 0) >= i.fine ? i.fine : Math.min(i.fine, player.credits || 0);
    if (fined) {
      player.credits = (player.credits || 0) - fined;
      await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
      sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
    }
    return { type: 'emote', message:
      `You break the seal yourself and stand back with your hands where they can see them.\n\n`
      + (seized
        ? `<span class="text-amber">They take ${seized === 1 ? 'it' : 'all of it'} off the deck and log it. Nobody says the word out loud.</span>\n\n`
        : '')
      + (fined ? `<span class="text-amber">A fine for ${fined}₵ goes through before the barrier lifts.</span>\n\n` : '')
      + `<span class="text-dim">No charge. You are a man with a bad load, not a man with a record — and that distinction is worth what it just cost you.</span>` };
  }

  if (what === 'bribe') {
    pending.delete(player.id);
    // Priced off the lie, so the big run is the expensive one to buy out of.
    const ask = Math.max(200, Math.round(Math.max(i.over, i.overRated) * 2.2));
    if ((player.credits || 0) < ask) {
      return { type: 'emote', message: `You reach for it and there is not enough there. It would take about ${ask}₵ to make this go away, and you do not have it. <span class="text-dim">customs open · customs bolt</span>` };
    }
    const ok = (await skillCheck(player, 'deception', 6)).success;
    player.credits -= ask;
    await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
    sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
    if (ok) {
      return { type: 'emote', message:
        `<span class="text-dim">You fold it into the paperwork without looking at it, and they take the paperwork without looking at it either.</span>\n\n`
        + `<span class="text-amber">${ask}₵.</span> The barrier goes up and nobody has said anything worth repeating.` };
    }
    await dispatchAction({ type: 'CHARGE_CRIME', actor: player, params: { key: 'bribery_attempt' } }).catch(() => {});
    await dispatchAction({ type: 'APPREHEND', actor: player, params: { officer: 'the scale-house officers' } }).catch(() => {});
    return { type: 'emote', message:
      `<span class="text-red">They look at the money, and then at you, for a good deal longer than is comfortable.</span>\n\n`
      + `"You want to try that again slower, so I get it on the record?" ${ask}₵ gone and the slate is out.` };
  }

  if (what === 'bolt') {
    pending.delete(player.id);
    // Running the scale is a CHASE on the corridor rather than an abstract roll — the truck is
    // already a driving sim, so the honest way to model a runner is to let them drive. What the
    // roll decides is whether they got the jump, not whether they escape.
    // PILOTING, not a new driving skill. There is no driving skill and inventing one for a single
    // roll would fragment the vehicle skill across two systems that already share a physics model —
    // a trucker and a pilot are both people who are good with a machine that moves.
    const ok = (await skillCheck(player, 'piloting', 7)).success;
    await dispatchAction({ type: 'CHARGE_CRIME', actor: player, params: { key: 'evading_police' } }).catch(() => {});
    if (ok) {
      return { type: 'emote', message:
        `<span class="text-amber">You let the clutch out while the officer is still looking at the slate.</span>\n\n`
        + `The barrier takes the mirror off the passenger side and you are through, wide open, watching the booth shrink. Somebody is on a radio behind you.\n\n`
        + `<span class="text-dim">That is on your record now, and this road has one way off it.</span>` };
    }
    await dispatchAction({ type: 'APPREHEND', actor: player, params: { officer: 'the scale-house officers' } }).catch(() => {});
    const fee = await impound(rig, i);
    return { type: 'emote', message:
      `<span class="text-red">You go for it and the spikes come up out of the deck before the barrier even moves.</span>\n\n`
      + `The rig sits down on its rims in fifty feet, and they are at the door before it stops rocking.\n\n`
      + (fee ? `<span class="text-amber">They tow it to the lot at ${i.name}. Getting it back will cost ${fee}₵.</span>` : '') };
  }
  return null;
}

// ── Impound ──────────────────────────────────────────────────────────────────
// The one gap the codebase has never had: a vehicle taken off you and put somewhere you have to BUY
// it back from. It is deliberately a two-column variation on ordinary hangar/depot storage rather
// than a new concept — the truck is parked at a zone, and that zone happens to charge to let it out.
//
// The fee is priced off the LIE, not off the truck, for the same reason the bribe is: what you are
// paying for is how much trouble you were in, and a cheap rig caught with three tonnes of nothing on
// the paper should not be a cheap afternoon.
async function impound(rig, i) {
  if (!rig?.truckId) return 0;
  const fee = Math.max(400, Math.round(Math.max(i.over, i.overRated) * 3.5));
  await query('UPDATE trucks SET depot_zone = $1, impound_fee = $2 WHERE id = $3',
    [i.zoneId, fee, rig.truckId]).catch(() => {});
  // Anything behind the bulkhead is gone. It was never on the paper, so there is nothing to give
  // back and nobody to complain to.
  if (rig.trailer) { rig.trailer.stash = null; await saveStash(rig.trailer.id, null); }
  return fee;
}

// Buying it out. Lives here rather than in the yard because the fee and the reason for it are the
// same fact, and a release that did not know what it was releasing you from would have to guess.
export async function releaseImpound(player, truckRow) {
  const fee = truckRow?.impound_fee || 0;
  if (!fee) return null;
  if ((player.credits || 0) < fee) {
    return { released: false, type: 'emote', message: `The lot wants <b>${fee}₵</b> to release it and you have ${player.credits || 0}₵. It is not going anywhere until that changes.` };
  }
  player.credits -= fee;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]).catch(() => {});
  await query('UPDATE trucks SET impound_fee = NULL WHERE id = $1', [truckRow.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', credits: player.credits });
  return { released: true, type: 'emote', message:
    `<span class="item-grant">You pay the ${fee}₵ and somebody unlocks a gate without looking up.</span>\n`
    + `<span class="text-dim">The mirror is still off the passenger side. Nobody mentions it.</span>` };
}

async function saveStash(trailerId, stash) {
  await query('UPDATE trailers SET stash = $1 WHERE id = $2',
    [stash?.length ? JSON.stringify(stash) : null, trailerId]).catch(() => {});
}

export const _test = { SLACK_KG, CERTAIN_KG, FINE_PER_KG, pending };
