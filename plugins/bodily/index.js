/**
 * Bodily plugin — bowel/bladder pressure (digestive_load / hydration_load,
 * hidden 0–110+ floats on the player row), threshold messages, involuntary
 * release, and the pee/poop/flush verbs. Extracted from engine/bodily.js +
 * commands/bodily.js (Phase 2, docs/proposals/engine-plugin-boundary.md).
 *
 * The engine keeps the substrate half of the old module: stains
 * (stainClothing/stainZone — also written by mis and butchering) and the
 * digestion loads (foodLoad/drinkLoad/applyThirst — read by drugs, inventory,
 * fillable, water). This plugin owns the pressure simulation and the verbs.
 *
 * SIFT ambiguous picks replay through the bodily.pee_target / bodily.poop_target
 * Actions (the builtin replay path can't reach plugin verbs).
 */
import { query } from '../../server/models/db.js';
import { stainClothing, stainZone, stainCreatureBodyPart, taintAir, depositIntoVessel } from '../../server/engine/bodily.js';
import { isMisActive } from '../../server/engine/mis.js';
import { getZonePlayers, getZoneEnemies, getZoneNpcs, getAllLivePlayers, getZoneFurniture } from '../../server/engine/world.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { registerAction } from '../../server/engine/actions.js';
import { registerStatusEffect, applyEffect } from '../../server/engine/effects.js';
import { schedule } from '../../server/engine/scheduler.js';
import { setPosture } from '../../server/engine/posture.js';
import { emit, on } from '../../server/engine/events.js';
import './help.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { coolSweat, markWashed, checkFilthy } from '../../server/engine/hygiene.js';
import { adjustRelation } from '../../server/engine/relations.js';

// What counts as a toilet. Historically this only checked object_type==='toilet'
// or a flags.toilet key, but most toilet furniture in content is typed 'furniture'
// or 'fixture' with neither — so relief, flush, and the fouled/peed describe line
// all silently missed them. Recognise a toilet by name too, so any furniture
// named "…toilet…" just works whether or not the dev remembered to tag it.
// SQL-side callers use TOILET_SQL to match the same three ways.
export const isToilet = (f) =>
  f?.object_type === 'toilet' || !!f?.flags?.toilet || /\btoilet\b/i.test(f?.name || '');
const TOILET_SQL = `(object_type='toilet' OR jsonb_exists(flags,'toilet') OR name ILIKE '%toilet%')`;

// What counts as a shower — the same three-way match as a toilet (object_type,
// a flags.shower key, or the word in the name), so a fixture named "…shower…"
// just works whether or not the dev remembered to type it.
export const isShower = (f) =>
  f?.object_type === 'shower' || !!f?.flags?.shower || /\bshower\b/i.test(f?.name || '');
const SHOWER_SQL = `(object_type='shower' OR jsonb_exists(flags,'shower') OR name ILIKE '%shower%')`;

// Runtime-only state. A toilet stays fouled (poop) / full of piss until flushed;
// toiletSessions guards against starting a toilet routine twice at once.
const fouledToilets  = new Set(); // furniture id — unflushed poop
const peedToilets    = new Set(); // furniture id — unflushed piss
const toiletSessions = new Map(); // playerId -> { mode, target, zoneId, seated, sitOn, droppedLegs, timers }
const showerSessions = new Map(); // playerId -> { zoneId, timers } — the timed shower ritual

// Foul / un-foul a toilet by furniture id. finishRelief fouls it; flush clears
// it. Contamination (the describe line + the water/fillable sickness) is derived
// live from these two sets, so clearing them here removes the pee, the poo, and
// thus the contamination in one shot. Exported so the round-trip is testable.
export function foulToilet(id, mode) {
  (mode === 'poop' ? fouledToilets : peedToilets).add(id);
}
export function clearToiletFilth(id) {
  fouledToilets.delete(id);
  peedToilets.delete(id);
}

// Disconnecting mid-routine cleanly cancels it: the live player object is about
// to be dropped (removeLivePlayer), so the setTimeout closures would otherwise
// fire against a stale object and race the reconnect. Clear the timers, restore
// any dropped legwear (don't leave them bottomless), and forget the session. No
// load reduction — they didn't finish, so they're still full. The loads
// themselves are persisted columns, so those survive reconnect regardless.
on('player.logout', ({ id }) => {
  const session = toiletSessions.get(id);
  if (!session) return;
  toiletSessions.delete(id);
  for (const t of session.timers) clearTimeout(t);
  for (const it of session.droppedLegs || []) {
    query(`UPDATE player_inventory SET is_equipped=1, slot='legs', layer=$1 WHERE id=$2`, [it.layer, it.id]).catch(() => {});
  }
});

// Same for a shower in progress: drop the timers so they don't fire against a
// stale player object after disconnect. They didn't finish, so nothing is cleaned.
on('player.logout', ({ id }) => endShower(id));

// How full you are, 0..1 — the intensity every bodily sound scales on. Both
// meters run 0..110 before an involuntary release, so this is simply "how badly
// did you need that". A full bladder is a hard, high, splattering jet; an almost
// empty one is a loose dribble that barely reaches.
const pressureOf = (v) => Math.max(0, Math.min(1, (Number(v) || 0) / 110));

// ── Pressure simulation (was engine tickBodily, on gameLoop's minute tick) ───

async function equippedSlotsFor(player, slotNames) {
  const { rows } = await query(
    `SELECT pi.slot FROM player_inventory pi WHERE pi.player_id=$1 AND pi.is_equipped=1 AND pi.slot = ANY($2)`,
    [player.id, slotNames]
  );
  return rows.map(r => r.slot);
}

async function involuntaryBowelRelease(player) {
  const coveredSlots = await equippedSlotsFor(player, ['legs']);
  // Legwear on → it soaks into the clothing and never reaches the floor.
  if (coveredSlots.length) await stainClothing(player, coveredSlots, 'feces');
  else await stainZone(player.current_zone, 'feces');
  sendToZone(player.current_zone, { type:'zone_event', message:`Something smells suddenly and sharply wrong nearby.` }, player.id);
  player.digestive_load = 0;
  return `<span style="color:var(--red)">Your body gives out. You lose control entirely. Your clothing is stained. The world will notice.</span>`;
}

async function involuntaryBladderRelease(player) {
  const coveredSlots = await equippedSlotsFor(player, ['legs']);
  // Legwear on → it soaks into the clothing and never reaches the floor.
  if (coveredSlots.length) await stainClothing(player, coveredSlots, 'urine');
  else await stainZone(player.current_zone, 'urine');
  sendToZone(player.current_zone, { type:'zone_event', message:`A small puddle spreads near someone's feet.` }, player.id);
  player.hydration_load = 0;
  return `<span style="color:var(--red)">You can't hold it any longer. It just… happens. Your clothing is wet. You stand very still for a moment.</span>`;
}

// Once per minute for each awake player (sleeping players' meters pause, same
// as the old engine tick, which skipped them).
async function tickBodily(player) {
  const messages = [];
  let digestive  = player.digestive_load  || 0;
  let hydration  = player.hydration_load  || 0;
  let changed = false;

  // No natural decay: waste doesn't evaporate by waiting — the load only rises
  // with intake (foodLoad/drinkLoad) and falls when you relieve yourself. The
  // >110 involuntary-release valve below is the only automatic way down.

  // Threshold ambient messages (fire occasionally, not every tick).
  // _tickCounter is maintained by the engine resource tick.
  const tickN = player._tickCounter || 0;

  if (digestive >= 80 && digestive < 110 && tickN % 3 === 0) {
    messages.push(pick(DIGESTIVE_PRESSURE));
  }
  if (hydration >= 80 && hydration < 110 && tickN % 3 === 0) {
    messages.push(pick(HYDRATION_PRESSURE));
  }

  // Involuntary fart — a growing warning as the pressure builds. Chance ramps
  // from ~2%/min at 60 up to ~20%/min by 110 (no farts below 60).
  if (digestive >= 60) {
    const p = 0.02 + (Math.min(110, digestive) - 60) / 50 * 0.18;
    if (Math.random() < p) {
      // This fires on its own, so it gets the same treatment a deliberate one
      // does: a rolled style, a matching line, and an actual SOUND. It used to
      // be a bare ambient string with no audio, and the person it happened to
      // wasn't even told — the room heard something and they didn't.
      const pressure = pressureOf(digestive);
      const style = rollFlatusStyle(pressure);
      const line = FART_STYLE_LINES[style] || FART_STYLE_LINES.brassy;
      messages.push(`<span style="color:var(--red)">It gets away from you. ${line.self}</span>`);
      sendToZone(player.current_zone, {
        type: 'ambient',
        message: `<span class="msg-ambient">${line.zone.replace('{who}', player.handle)}</span>`,
      }, player.id);
      emit('bodily.sfx', { zoneId: player.current_zone, playerId: player.id, cue: 'fart', intensity: pressure, style });
      // The sound is the joke; the smell is the consequence. It hangs for about
      // a minute, so walking away really does escape it and standing there
      // really doesn't.
      taintAir(player.current_zone, 'fart');
    }
  }

  // Overflow — involuntary release
  if (digestive > 110) {
    messages.push(await involuntaryBowelRelease(player));
    digestive = 0;
    changed = true;
  }
  if (hydration > 110) {
    messages.push(await involuntaryBladderRelease(player));
    hydration = 0;
    changed = true;
  }

  if (changed) {
    player.digestive_load  = digestive;
    player.hydration_load  = hydration;
    await query('UPDATE players SET digestive_load=$1, hydration_load=$2 WHERE id=$3',
      [digestive, hydration, player.id]);
  }

  return messages;
}

schedule('1m', async () => {
  for (const player of getAllLivePlayers()) {
    // Sweat dries on everyone, asleep or not — it's the one part of this that
    // isn't digestion. In memory, no write (engine hygiene owns the meter).
    coolSweat(player);
    // Slow cadence on purpose: the filth latch must not live on the smell path.
    checkFilthy(player);
    if (player.sleeping) continue;
    const messages = await tickBodily(player);
    if (messages.length) sendToPlayer(player.id, { type: 'resource_tick', messages });
  }
});

// ── Relief (was engine relieveBladder/relieveBowels) ─────────────────────────
// target: optional { type: 'toilet'|'ground'|'player'|'furniture', name, target: playerObj }

async function relieveBladder(player, hasFacility, broadcast, target = null) {
  if ((player.thirst || 0) === 0) {
    return { ok: false, message: `You're too dehydrated. There's nothing to release.` };
  }

  // Pissing on a creature (player / enemy / NPC), optionally aimed at a body part
  if (target?.type === 'player') {
    const tp = target.target;
    const name = tp.handle || tp.name || 'them';
    const part = target.part || null;
    const where = part ? `${name}'s ${part}` : name;
    const reduction = 55;
    player.hydration_load = Math.max(0, (player.hydration_load || 0) - reduction);
    await query('UPDATE players SET hydration_load=$1 WHERE id=$2', [player.hydration_load, player.id]);
    if (tp._bkind === 'player') await stainCreatureBodyPart(tp, 'urine', part);
    broadcast(player.current_zone, {
      type: 'zone_event',
      message: `${player.handle} pisses on ${where}.`,
    }, player.id, tp.id);
    if (tp.handle) broadcast(null, { type: 'output', message: `${player.handle} pisses on your ${part || 'body'}.` }, null, tp.id);
    // Decoupled: the MIS plugin listens and turns this into arousal for the
    // opted-in (a watersports kink). Bodily stays ignorant of who cares.
    emit('bodily.pissedOnCreature', { actor: player, target: tp, part, zoneId: player.current_zone });
    return { ok: true, message: `You piss on ${where}.` };
  }

  // Pissing on furniture
  if (target?.type === 'furniture') {
    const reduction = 55;
    player.hydration_load = Math.max(0, (player.hydration_load || 0) - reduction);
    await query('UPDATE players SET hydration_load=$1 WHERE id=$2', [player.hydration_load, player.id]);
    await stainZone(player.current_zone, 'urine');
    broadcast(player.current_zone, { type: 'zone_event', message: `The sharp smell of urine rises near the ${target.name}.` }, player.id);
    return { ok: true, message: `You relieve yourself all over the ${target.name}. It didn't deserve that. Or maybe it did.` };
  }

  const covered = await equippedSlotsFor(player, ['legs']);
  // A man just unzips and pushes his boxers aside — no need to undress and no
  // stain. Anyone else soaks their legwear if there's no facility to sit at.
  const unzips = player.biological_sex === 'male' && covered.length > 0;
  let stained = false;
  if (!hasFacility && covered.length && !unzips) {
    await stainClothing(player, covered, 'urine');
    stained = true;
  }
  // Sitting/standing at a toilet you fully void; a rushed pee elsewhere doesn't.
  const reduction = hasFacility ? 90 : 55;
  player.hydration_load = Math.max(0, (player.hydration_load || 0) - reduction);
  await query('UPDATE players SET hydration_load=$1 WHERE id=$2', [player.hydration_load, player.id]);

  if (hasFacility) {
    return { ok: true, message: pick(TOILET_PEE_MSGS), private: true };
  }
  // Soaked into legwear → nothing reaches the floor.
  if (!stained) {
    await stainZone(player.current_zone, 'urine');
    broadcast(player.current_zone, { type:'zone_event', message: `A stream hits the ground nearby.` }, player.id);
  }
  return {
    ok: true,
    message: stained
      ? `You go where you stand. Your ${covered[0] || 'clothing'} soaks it all up.`
      : unzips
      ? `You unzip, push your boxers aside, and let go. No fuss, no mess.`
      : pick(GROUND_PEE_MSGS),
  };
}

async function relieveBowels(player, hasFacility, broadcast, target = null) {
  if ((player.hunger || 0) === 0) {
    return { ok: false, message: `You haven't eaten enough to produce anything.` };
  }

  // Shitting on a creature (player / enemy / NPC) — the lying gate is enforced
  // upstream. Optionally aimed at a body part.
  if (target?.type === 'player') {
    const tp = target.target;
    const name = tp.handle || tp.name || 'them';
    const part = target.part || null;
    const where = part ? `${name}'s ${part}` : name;
    const reduction = 60;
    player.digestive_load = Math.max(0, (player.digestive_load || 0) - reduction);
    await query('UPDATE players SET digestive_load=$1 WHERE id=$2', [player.digestive_load, player.id]);
    if (tp._bkind === 'player') await stainCreatureBodyPart(tp, 'feces', part);
    broadcast(player.current_zone, {
      type: 'zone_event',
      message: `${player.handle} squats over ${where} and shits on ${part ? 'it' : 'them'}.`,
    }, player.id, tp.id);
    if (tp.handle) broadcast(null, { type: 'output', message: `${player.handle} squats over you and shits on your ${part || 'body'}.` }, null, tp.id);
    return { ok: true, message: `You squat over ${where} and do it. That's a statement.` };
  }

  // Shitting on furniture
  if (target?.type === 'furniture') {
    const reduction = 60;
    player.digestive_load = Math.max(0, (player.digestive_load || 0) - reduction);
    await query('UPDATE players SET digestive_load=$1 WHERE id=$2', [player.digestive_load, player.id]);
    broadcast(player.current_zone, {
      type: 'zone_event',
      message: `The smell of something biological hits the air near the ${target.name}.`,
    }, player.id);
    return { ok: true, message: `You squat over the ${target.name} and relieve yourself on it. It needed that.` };
  }

  const covered = await equippedSlotsFor(player, ['legs']);
  let stained = false;
  if (!hasFacility && covered.length) {
    await stainClothing(player, covered, 'feces');
    stained = true;
  }
  const reduction = hasFacility ? 75 : 60;
  player.digestive_load = Math.max(0, (player.digestive_load || 0) - reduction);
  await query('UPDATE players SET digestive_load=$1 WHERE id=$2', [player.digestive_load, player.id]);

  if (hasFacility) {
    return { ok: true, message: pick(TOILET_POOP_MSGS), private: true };
  }
  // Soaked into legwear → nothing reaches the floor (the smell still carries).
  if (!stained) await stainZone(player.current_zone, 'feces');
  broadcast(player.current_zone, { type:'zone_event', message: `The smell of something biological drifts through the air.` }, player.id);
  return {
    ok: true,
    message: stained
      ? `You go where you stand. Your clothing is stained. Dignity: impacted.`
      : pick(GROUND_POOP_MSGS),
  };
}

// ── Relief routine (shared by every pee/poop, whatever the target) ───────────
// Relief is never instant. You take a posture (pooping drops your legwear and
// squats; peeing stands, or sits if you're a woman with something to sit on),
// hold it for a timed spell punctuated by sound and the odd fart, and only then
// does anything land. What changes per target is purely where it goes — a
// toilet, the ground, a piece of furniture, or a hapless creature. No MIS gate.

async function getToilet(zoneId) {
  const { rows } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND ${TOILET_SQL} LIMIT 1`,
    [zoneId]
  );
  return rows[0] || null;
}

// Poop needs a lying victim: a player who's lying/sleeping, or a sleeping-at-home
// NPC (the AI sets posture 'lying'). Enemies have no posture, so they never
// qualify. Pee has no such gate.
function isLyingTarget(being) {
  return being?.posture === 'lying' || being?.sleeping || being?.offline_sleeping;
}

// True while the actor is still in position: a seated routine needs them still
// sitting where they sat; a standing one only needs them not to have left.
function stillInPosition(player, session) {
  if (player.current_zone !== session.zoneId) return false;
  if (!session.seated) return true;
  return player.posture === 'sitting' && player.sittingOn === session.sitOn;
}

// A fart during the routine — private line, a zone noise, and the sound cue.
function tickFart(player, session, chance) {
  if (!toiletSessions.has(player.id) || !stillInPosition(player, session)) return;
  if (Math.random() < chance) {
    const f = pick(FART_LINES);
    sendToPlayer(player.id, { type: 'output', message: `<span class="text-dim">${f.self}</span>` });
    sendToZone(session.zoneId, { type: 'ambient', message: `<span class="msg-ambient">${f.zone}</span>` }, player.id);
    emit('bodily.sfx', { zoneId: session.zoneId, playerId: player.id, cue: 'fart', intensity: pressureOf(player.digestive_load) });
    // And it HANGS. A fart isn't a stain — there's nothing on the floor — so it
    // goes in the air channel and fades on its own in about a minute. Anyone who
    // walks in during that window and types `smell` finds out.
    taintAir(session.zoneId, 'fart');
  }
  session.timers.push(setTimeout(() => tickFart(player, session, chance), 5000 + Math.random() * 4000));
}

// Occasional wet plop while pooping — sound only, no text spam.
function tickPlop(player, session) {
  if (!toiletSessions.has(player.id) || !stillInPosition(player, session)) return;
  if (Math.random() < 0.5) emit('bodily.sfx', { zoneId: session.zoneId, playerId: player.id, cue: 'plop' });
  session.timers.push(setTimeout(() => tickPlop(player, session), 5000 + Math.random() * 4000));
}

// Pee stream — a steady flow for the 10s hold that never just cuts off: every so
// often it tapers into a soft fade, dribbles a couple of times, then picks back
// up. The surface tag varies the splash: water (toilet), concrete, soft
// (furniture), body.
function tickStream(player, session) {
  if (!toiletSessions.has(player.id) || !stillInPosition(player, session)) return;

  // Taper into a lull instead of another steady pulse.
  if (Math.random() < 0.3) {
    emit('bodily.sfx', { zoneId: session.zoneId, playerId: player.id, cue: 'stream_fade', surface: session.streamSurface, intensity: session.pressure });
    const dribbles = 1 + Math.floor(Math.random() * 3);
    let delay = 500 + Math.random() * 300;
    for (let i = 0; i < dribbles; i++) {
      session.timers.push(setTimeout(() => {
        if (!toiletSessions.has(player.id) || !stillInPosition(player, session)) return;
        emit('bodily.sfx', { zoneId: session.zoneId, playerId: player.id, cue: 'stream_dribble', surface: session.streamSurface, intensity: session.pressure });
      }, delay));
      delay += 350 + Math.random() * 300;
    }
    session.timers.push(setTimeout(() => tickStream(player, session), delay + 400 + Math.random() * 500));
    return;
  }

  emit('bodily.sfx', { zoneId: session.zoneId, playerId: player.id, cue: 'stream', surface: session.streamSurface, intensity: session.pressure });
  session.timers.push(setTimeout(() => tickStream(player, session), 1800 + Math.random() * 900));
}

const STREAM_SURFACE = { toilet: 'water', ground: 'concrete', furniture: 'soft', creature: 'body' };

// More bowel pressure → more escaping farts: a desperate poop is noisier than a
// routine one. (digestive_load only drops at the finish, so this reads once at
// the start — which is exactly the "how full were you" signal we want.)
function poopFartChance(player) {
  const load = player.digestive_load || 0;
  return 0.5 * (0.5 + Math.min(1, load / 90) * 0.8); // ~0.29 near-empty → ~0.65 very full
}

// The waste's destination + how the actor stands/sits for it.
// target: { kind:'toilet'|'furniture', furniture }
//       | { kind:'ground' }
//       | { kind:'creature', being, isNpc, isEnemy }
async function startRelief(player, mode, target, broadcast) {
  const isPoop = mode === 'poop';

  // 1. Anything to release?
  if (isPoop && (player.hunger || 0) === 0)
    return { type: 'error', message: `You haven't eaten enough to produce anything.` };
  if (!isPoop && (player.thirst || 0) === 0)
    return { type: 'error', message: `You're too dehydrated. There's nothing to release.` };
  // 2. Already mid-business?
  if (toiletSessions.has(player.id))
    return { type: 'error', message: `You're already busy, doing your business.` };
  // 3. Poop needs a lying victim.
  if (isPoop && target.kind === 'creature' && !isLyingTarget(target.being)) {
    const who = target.being.name || target.being.handle || 'They';
    return { type: 'error', message: `${who} would have to be lying down for that.` };
  }

  // 4. Into a carried vessel. Short-circuits the whole timed routine — you are
  //    aiming at something in your hands, not settling in — and produces an
  //    ingredient item inside it, which the cooking plugin then treats as any
  //    other ingredient. The load still empties, so this is a legitimate way to
  //    relieve yourself with no toilet in sight, at a cost to your dignity.
  if (target.kind === 'vessel') {
    const ok = await depositIntoVessel(player, target.vessel, isPoop ? 'feces' : 'urine');
    if (!ok) return { type: 'error', message: `You can't do that into the ${target.vessel.name}.` };
    if (isPoop) player.digestive_load = 0; else player.hydration_load = 0;
    await query('UPDATE players SET digestive_load=$1, hydration_load=$2 WHERE id=$3',
      [player.digestive_load || 0, player.hydration_load || 0, player.id]).catch(() => {});
    sendToZone(player.current_zone, { type: 'zone_event',
      message: `${player.handle} relieves themselves into a ${target.vessel.name}, with the composure of someone who has decided this is normal.` }, player.id);
    emit('bodily.publicRelief', { player, zoneId: player.current_zone });
    return { type: 'output', message: isPoop
      ? `You squat over the ${target.vessel.name} and fill it. It is warm, and it is yours, and it is in a bowl.`
      : `You piss into the ${target.vessel.name} until it sloshes. Nobody was going to use it for anything else. Probably.` };
  }

  const surface = (target.kind === 'toilet' || target.kind === 'furniture') ? target.furniture.name : null;
  // Pooping always squats (sitting). Peeing sits only for a woman with somewhere
  // to sit; otherwise she — and every man — stands.
  const seated = isPoop || (player.biological_sex === 'female' && !!surface);
  const sitOn = seated ? surface : null;

  // Poop drops every layer off the legs first — remembered so we can pull them
  // back up when the deed is done (an interrupted run leaves you bottomless).
  let dropped = '';
  let droppedLegs = [];
  if (isPoop) {
    const { rows: legItems } = await query(
      `SELECT pi.id, pi.layer, i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id
       WHERE pi.player_id=$1 AND pi.is_equipped=1 AND pi.slot='legs'`, [player.id]);
    await query(
      `UPDATE player_inventory SET is_equipped=0, slot=NULL, layer=NULL, equipped_at=NULL
       WHERE player_id=$1 AND slot='legs' AND is_equipped=1`, [player.id]);
    droppedLegs = legItems.map(r => ({ id: r.id, layer: r.layer }));
    dropped = legItems.length ? `You drop your ${legItems[legItems.length - 1].name}. ` : '';
  }

  if (seated) setPosture(player, 'sitting', { sittingOn: sitOn });

  const streamSurface = STREAM_SURFACE[target.kind] || 'concrete';
  // Snapshot the pressure at the start. The load is zeroed the moment relief
  // finishes, so reading it live would make the stream change character
  // mid-flow and the final dribble come out at zero intensity.
  const pressure = pressureOf(mode === 'poop' ? player.digestive_load : player.hydration_load);
  const session = { mode, target, zoneId: player.current_zone, seated, sitOn, droppedLegs, streamSurface, pressure, timers: [], broadcast };
  toiletSessions.set(player.id, session);

  if (isPoop) {
    // Duration scales with how full the bowel is: a full one (load ≥100) takes the
    // full 20–40s, a barely-full one tapers down toward an ~8s floor (poop stays a
    // commitment — never instant).
    const scale = Math.min(1, (player.digestive_load || 0) / 100);
    const duration = 8000 + Math.round(12000 * scale) + Math.floor(Math.random() * Math.round(20000 * scale));
    const fartChance = poopFartChance(player);
    session.timers.push(setTimeout(() => tickFart(player, session, fartChance), 4000));
    session.timers.push(setTimeout(() => tickPlop(player, session), 6000));
    session.timers.push(setTimeout(() => finishRelief(player, session).catch(logErr), duration));
  } else {
    // Duration scales with how full the bladder is: a full one (load ≥100) takes
    // the full 10s, a barely-full one tapers down toward a ~3.5s floor (never
    // instant — the onset + swell-in alone is ~1.2s).
    const load = player.hydration_load || 0;
    const duration = 3500 + Math.round(6500 * Math.min(1, load / 100));
    // Onset first (the pressure release / swell-in), then the steady stream once
    // the jet has found its footing (~1s in).
    session.timers.push(setTimeout(() => {
      if (toiletSessions.has(player.id) && stillInPosition(player, session))
        emit('bodily.sfx', { zoneId: session.zoneId, playerId: player.id, cue: 'stream_start', surface: session.streamSurface, intensity: session.pressure });
    }, 300));
    session.timers.push(setTimeout(() => tickStream(player, session), 1200));
    session.timers.push(setTimeout(() => tickFart(player, session, 0.12), Math.min(5000, duration * 0.5)));
    session.timers.push(setTimeout(() => finishRelief(player, session).catch(logErr), duration));
  }

  return { type: 'output', message: dropped + openingLine(mode, target, seated) };
}

function logErr(e) { console.error(`[bodily] relief error: ${e.message}`); }

function targetLabel(target) {
  if (target.kind === 'creature') {
    const name = target.being.name || target.being.handle || 'them';
    return target.part ? `${name}'s ${target.part}` : name;
  }
  if (target.kind === 'ground') return null;
  return target.furniture.name;
}

function openingLine(mode, target, seated) {
  const t = targetLabel(target);
  if (mode === 'pee') {
    if (target.kind === 'creature') return `You aim at ${t} and let go.`;
    if (t) return seated ? `You settle onto the ${t} and let go.` : `You step up to the ${t} and let go.`;
    return `You plant your feet and let go where you stand.`;
  }
  if (target.kind === 'creature') return `You squat over ${t}. Nature will not be rushed.`;
  if (t) return `You settle onto the ${t}. Nature will not be rushed.`;
  return `You squat down where you stand. Nature will not be rushed.`;
}

// Land the result — reuse the target-specific effects in relieveBladder/Bowels,
// then push the private line (they run delayed, so we can't return it).
async function finishRelief(player, session) {
  toiletSessions.delete(player.id);
  for (const t of session.timers) clearTimeout(t);
  if (!stillInPosition(player, session)) return; // interrupted — nothing lands

  const { mode, target, broadcast } = session;
  const isPoop = mode === 'poop';
  const relieve = isPoop ? relieveBowels : relieveBladder;
  let result;

  if (target.kind === 'toilet') {
    result = await relieve(player, true, broadcast);
    foulToilet(target.furniture.id, mode);
  } else if (target.kind === 'furniture') {
    result = await relieve(player, false, broadcast, { type: 'furniture', name: target.furniture.name });
  } else if (target.kind === 'creature') {
    result = await relieve(player, false, broadcast, { type: 'player', target: target.being, part: target.part });
    if (target.isNpc) antagonizeNpc(player, target.being, mode, broadcast);
  } else {
    result = await relieve(player, false, broadcast); // ground
  }

  // Sometimes cap a poop with a big fart + plop.
  if (isPoop && Math.random() < 0.55)
    emit('bodily.sfx', { zoneId: session.zoneId, playerId: player.id, cue: 'finale', intensity: pressureOf(player.digestive_load) });

  // Cap a pee with a few isolated residual drips at irregular intervals (the
  // spec's "final drips" — the stream never just cuts off). Fire-and-forget:
  // the session is already torn down, and the drips are personal sound only.
  if (!isPoop) {
    let d = 300 + Math.random() * 200;
    const drips = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < drips; i++) {
      setTimeout(() => emit('bodily.sfx', { zoneId: session.zoneId, playerId: player.id, cue: 'final_drip', surface: session.streamSurface, intensity: session.pressure }), d);
      d += 250 + Math.random() * 350;
    }
  }

  // Doing your business anywhere but a toilet is public indecency: disgusted
  // bystanders + an indecent-exposure charge (surveillance witness-gates it, so
  // it only heats you if a camera/cop/player actually caught you).
  if (result?.ok && target.kind !== 'toilet') {
    emit('bodily.publicRelief', { player, zoneId: session.zoneId });
    if (target.kind !== 'creature') reactBystanderNpc(session.zoneId, mode, broadcast);
  }

  // Pull your clothes back up (we're here, so the run wasn't interrupted).
  let restored = '';
  if (session.droppedLegs?.length) {
    for (const it of session.droppedLegs) {
      await query(
        `UPDATE player_inventory SET is_equipped=1, slot='legs', layer=$1 WHERE id=$2`,
        [it.layer, it.id]
      );
    }
    restored = ` You pull your clothes back up.`;
  }

  if (session.seated) setPosture(player, 'standing');
  if (result) sendToPlayer(player.id, { type: result.ok ? 'output' : 'error', message: result.message + (result.ok ? restored : '') });
}

// A peed-/pooped-on NPC yells about it.
function antagonizeNpc(player, npc, mode, broadcast) {
  const line = pick(mode === 'pee' ? NPC_PEE_YELLS : NPC_POOP_YELLS);
  broadcast(player.current_zone, { type: 'zone_event', message: `${npc.name} shouts, "${line}"` });
}

// A random bystander NPC recoils at a public elimination.
function reactBystanderNpc(zoneId, mode, broadcast) {
  const npcs = getZoneNpcs(zoneId).filter(n => !n._dead);
  if (!npcs.length) return;
  const npc = pick(npcs);
  const line = pick(mode === 'pee' ? NPC_PEE_WITNESS : NPC_POOP_WITNESS);
  broadcast(zoneId, { type: 'zone_event', message: `${npc.name} ${line}` });
}

// ── Target resolution ────────────────────────────────────────────────────────

function creatureTarget(being, part = null) {
  return { kind: 'creature', being, isNpc: being._bkind === 'npc', isEnemy: being._bkind === 'enemy', part };
}

async function defaultTarget(player) {
  const toilet = await getToilet(player.current_zone);
  return toilet ? { kind: 'toilet', furniture: toilet } : { kind: 'ground' };
}

// Resolve "on <name>" / "in <name>" / "on <name>'s <part>" to a target
// descriptor. Returns null for no args (caller falls back to the
// toilet-or-ground default), or a descriptor with kind 'ambiguous' |
// 'notfound' | 'toilet' | 'furniture' | 'creature'.
async function resolveBodilyTarget(args, player, dispatchType) {
  const str = args.join(' ').replace(/^(?:on|in|at)\s+/i, '').trim();
  if (!str) return null;

  // A carried vessel wins over everything else in the room, because "pee in the
  // bowl" can only sensibly mean the bowl you are holding. The product is an
  // ordinary ingredient item dropped inside it — see depositIntoVessel — so the
  // cooking plugin picks it up with no changes of its own.
  const vessel = await resolveInventoryItem(player, { tag: 'vessel', name: str, topLevel: true });
  if (vessel) return { kind: 'vessel', vessel };

  // "<name>'s <part>" — aim at a specific body part (e.g. "alice's face").
  const partMatch = str.match(/^(.+?)'s\s+(.+)$/i);
  const searchStr = partMatch ? partMatch[1].trim() : str;
  const part = partMatch ? partMatch[2].trim() : null;

  // Any creature in the zone — players, enemies, NPCs — in one SIFT pass.
  const candidates = [
    ...getZonePlayers(player.current_zone).filter(p => p.id !== player.id)
      .map(p => ({ ...p, name: p.handle, _bkind: 'player' })),
    ...getZoneEnemies(player.current_zone).map(e => ({ ...e, name: e.name, _bkind: 'enemy' })),
    ...getZoneNpcs(player.current_zone).filter(n => !n._dead).map(n => ({ ...n, name: n.name, _bkind: 'npc' })),
  ];
  const r = siftResolve(searchStr, candidates);
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { dispatchType, dispatchParam: 'target' });
    return { kind: 'ambiguous', selection: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  if (r.type === 'match') return creatureTarget(r.candidate, part);

  // Offline sleeping body (a valid poop victim).
  const { rows: sleepers } = await query(
    `SELECT * FROM players WHERE LOWER(handle) LIKE $1 AND current_zone=$2 AND offline_sleeping=TRUE LIMIT 1`,
    [`%${searchStr.toLowerCase()}%`, player.current_zone]
  );
  if (sleepers.length) return creatureTarget({ ...sleepers[0], name: sleepers[0].handle, _bkind: 'player' }, part);

  // Furniture — a toilet gets the fouled/flush treatment; anything else is fair game.
  const { rows: furniture } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND name ILIKE $2 LIMIT 1`,
    [player.current_zone, `%${str}%`]
  );
  if (furniture.length) {
    const f = furniture[0];
    return { kind: isToilet(f) ? 'toilet' : 'furniture', furniture: f };
  }

  return { kind: 'notfound', str };
}

// ── Verbs (was commands/bodily.js) ───────────────────────────────────────────

async function cmdRelief(mode, args, player, broadcast) {
  const dispatchType = mode === 'pee' ? 'bodily.pee_target' : 'bodily.poop_target';
  const res = await resolveBodilyTarget(args, player, dispatchType);
  if (res?.kind === 'ambiguous') return { type: 'output', message: res.selection };
  if (res?.kind === 'notfound')  return { type: 'error',  message: `You don't see "${res.str}" here.` };
  const target = res || await defaultTarget(player);
  return startRelief(player, mode, target, broadcast);
}

const cmdPee  = (args, player, broadcast) => cmdRelief('pee',  args, player, broadcast);
const cmdPoop = (args, player, broadcast) => cmdRelief('poop', args, player, broadcast);

async function cmdFlush(args, player) {
  const { rows } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND ${TOILET_SQL}`,
    [player.current_zone]
  );
  if (!rows.length) return { type:'error', message:`There's no toilet here to flush.` };
  // Was any toilet here actually fouled? Clear every toilet in the room so none
  // is left dirty — this wipes the pee, the poo, and thus the water contamination.
  const wasDirty = rows.some(r => fouledToilets.has(r.id) || peedToilets.has(r.id));
  for (const r of rows) clearToiletFilth(r.id);
  emit('bodily.sfx', { zoneId: player.current_zone, cue: 'flush' });
  return {
    type: 'output',
    message: wasDirty
      ? `You flush. The mess swirls away and the water runs clean again.`
      : `You flush. The sound is deeply satisfying.`,
  };
}

// A brief cosmetic badge after a shower — no mechanical tick, just a visible
// "Refreshed" status (same purely-visual pattern as weightbench's Exhausted).
registerStatusEffect({ name: 'refreshed', label: 'Refreshed', onTick() {} });

// Shower — the thorough clean, played as a short, unhurried ritual rather than a
// one-liner. `wash` (owned by the MIS plugin) rinses off dried fluid + blood at
// any sink/rain in a single line; a shower is the luxury version: hot water over
// three beats (~15s), and only at the end does it strip EVERYTHING — the pee/poop
// stains bodily itself produces (clothing_contamination + bare-skin soiled_state)
// as well as the dried fluid and blood — and leave you briefly Refreshed. Gated on
// a shower fixture in the zone (object_type='shower' / flags.shower / named).
const SHOWER_OPEN = `You twist the valve and step in. The water comes through hot and heavy, drumming across your shoulders, and steam climbs the glass until the room beyond it blurs to gold.`;
const SHOWER_MID = [
  `You tip your head back and let it sheet over your face, through your hair, down the length of your spine. The day begins, grudgingly, to let go of you.`,
  `Heat works its way into muscle you didn't know was clenched. Lather, steam, a long exhale — you lose track of where the water stops and you begin.`,
];
const SHOWER_DONE_DIRTY = `One last turn toward cold, then off. You step out wreathed in steam and pull a towel thick as a rug around yourself. Every trace of the day has gone down the drain — you feel entirely, luxuriously human again.`;
const SHOWER_DONE_CLEAN = `One last turn toward cold, then off. Nothing needed scrubbing, but the heat alone was worth the water bill. You step out into the steam, towel down, and feel refreshed to the bone.`;
const SHOWER_BROKEN = `You step out of the water half-rinsed, the ritual broken.`;

// Forget a shower session and cancel its remaining beats. Keyed by player id so
// the logout hook can call it without a live player object.
function endShower(id) {
  const s = showerSessions.get(id);
  if (!s) return;
  showerSessions.delete(id);
  for (const t of s.timers) clearTimeout(t);
}

// A staged beat only proceeds while THIS session is still live and the player is
// still standing under the water; stepping away (or disconnecting) aborts the rest
// of the ritual with no clean and no Refreshed.
function showerStage(player, session, fn) {
  return () => {
    if (showerSessions.get(player.id) !== session) return; // cancelled / superseded
    if (player.current_zone !== session.zoneId || player.offline_sleeping) {
      endShower(player.id);
      sendToPlayer(player.id, { type:'output', private:true, message: SHOWER_BROKEN });
      return;
    }
    fn();
  };
}

async function cmdShower(player) {
  const { rows } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND ${SHOWER_SQL} LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return { type:'error', message:`There's no shower here.` };
  if (showerSessions.has(player.id)) return { type:'error', message:`You're already under the water.` };

  const session = { zoneId: player.current_zone, timers: [] };
  showerSessions.set(player.id, session);
  emit('bodily.sfx', { zoneId: player.current_zone, playerId: player.id, cue: 'shower' });

  const step = (delay, fn) => session.timers.push(setTimeout(showerStage(player, session, fn), delay));
  step(5000,  () => sendToPlayer(player.id, { type:'output', private:true, message: SHOWER_MID[0] }));
  step(10000, () => sendToPlayer(player.id, { type:'output', private:true, message: SHOWER_MID[1] }));
  step(15000, () => finishShower(player, session).catch(logErr));

  return { type:'output', private:true, message: SHOWER_OPEN };
}

// The pay-off, applied only if the player stayed under the water the whole ritual.
async function finishShower(player, session) {
  endShower(player.id);

  let cleaned = false;

  // Clothing stains (urine/feces) — clear every soiled slot.
  if (player.clothing_contamination && Object.keys(player.clothing_contamination).length) {
    player.clothing_contamination = {};
    await query(`UPDATE players SET clothing_contamination='{}'::jsonb WHERE id=$1`, [player.id]);
    cleaned = true;
  }

  // Bare-skin soiling + any dried fluid — a full rinse takes both. (These are
  // plain appearance_data fields read openly by appearance.js; clearing them
  // here is a rinse, not MIS logic — no cross-plugin coupling.)
  const ad = player.appearance_data || {};
  if (ad.soiled_state || ad.ejaculate_state) {
    ad.soiled_state = null;
    ad.ejaculate_state = null;
    player.appearance_data = ad;
    await query('UPDATE players SET appearance_data=$1 WHERE id=$2', [JSON.stringify(ad), player.id]);
    cleaned = true;
  }

  // Blood.
  if (player.covered_in_blood) {
    player.covered_in_blood = 0;
    await query('UPDATE players SET covered_in_blood=0 WHERE id=$1', [player.id]);
    cleaned = true;
  }

  // A shower is the most thorough wash in the game — it resets the hygiene clock
  // and the sweat with it.
  await markWashed(player);
  applyEffect(player, 'refreshed', 180); // ~3 min visible badge
  sendToPlayer(player.id, { type:'output', private:true, message: cleaned ? SHOWER_DONE_DIRTY : SHOWER_DONE_CLEAN });
}

// An unflushed toilet reads that way on a look, until someone flushes it.
export const hooks = {
  // An unflushed toilet has no floor stain — the mess is in the bowl — so
  // nothing else would ever report it. It's also the single most useful thing
  // smell can tell you before you decide to use one.
  'zone.smells': (zone) => {
    const here = getZoneFurniture(zone.id).filter(isToilet);
    const out = [];
    if (here.some(f => fouledToilets.has(f.id))) {
      out.push({ text: 'a toilet somebody used and did not flush', strength: 9, source: 'feces' });
    }
    if (here.some(f => peedToilets.has(f.id))) {
      out.push({ text: 'stale piss standing in a bowl', strength: 7, source: 'urine' });
    }
    return out;
  },
  'furniture.describe': (f) => {
    if (!isToilet(f)) return undefined;
    const lines = [];
    if (fouledToilets.has(f.id)) lines.push(`Someone left a grim deposit behind and never flushed.`);
    if (peedToilets.has(f.id))   lines.push(`The bowl is full of stale, unflushed piss.`);
    return lines.length ? `<span style="color:var(--red)">${lines.join(' ')}</span>` : undefined;
  },
};

// ── Contaminated water ───────────────────────────────────────────────────────
// A toilet keeps its water_source capability (you can still drink/fill from it),
// but once it's been peed/pooped in and not flushed, that water is foul. The
// fouled/peed state lives in the runtime Sets above; the water + fillable plugins
// don't import them — they ask over the action registry. Drinking foul water
// still slakes thirst (you did swallow it), but you catch something for it.

// Dysentery from foul water: nausea comes in waves, not a per-second drip.
// Every ~20s a bout hits, draining stamina AND HP together. It's miserable but
// never lethal on its own — cramps leave you doubled over, not dead.
registerStatusEffect({
  name: 'sick',
  label: 'Sick',
  onTick(player) {
    // Hold off ~20s between bouts so the log isn't spammed every tick.
    player._sickWaveIn = (player._sickWaveIn ?? 20) - 1;
    if (player._sickWaveIn > 0) return undefined;
    player._sickWaveIn = 20;

    const parts = [];
    const staBefore = player.stamina ?? (player.stamina_max ?? 100);
    const sta = Math.max(0, staBefore - 15);
    if (sta < staBefore) { parts.push(`-${staBefore - sta} STA`); player.stamina = sta; }

    // Floor at 1 — sickness can lay you low but won't be the thing that kills you.
    const hp = Math.max(1, player.hp - 6);
    if (hp < player.hp) { parts.push(`-${player.hp - hp} HP`); player.hp = hp; }

    if (!parts.length) return undefined;
    return `A wave of nausea doubles you over — your stomach cramps and heaves. (${parts.join(', ')})`;
  },
});

// Query: is this toilet (by furniture id) currently fouled? Returns booleans so a
// caller can tailor the flavour ("piss", "worse") without touching the Sets.
registerAction({
  type: 'bodily.toiletContamination',
  handler: ({ params }) => {
    const id = params.furnitureId;
    return { type: 'data', fouled: fouledToilets.has(id), peed: peedToilets.has(id) };
  },
});

// Effect: swallow foul water. Applies the sickness and returns the flavour line
// (tailored by which contamination is present). Callers append it to their own
// "you drink" message.
registerAction({
  type: 'bodily.drinkContaminated',
  handler: ({ actor, params }) => {
    applyEffect(actor, 'sick', 40);
    const worse = params.fouled;
    return {
      type: 'data',
      message: worse
        ? `<span style="color:var(--red)">It's fouled with someone's leavings. You gag it down anyway. Your gut lurches in protest — this was a mistake.</span>`
        : `<span style="color:var(--red)">The water is warm, stale, and reeks of piss. You drink it anyway, and immediately regret it.</span>`,
    };
  },
});

// SIFT selection replays for the on-creature variants (candidates are always
// creatures — players/enemies/NPCs — so the pick is a creature target).
registerAction({
  type: 'bodily.pee_target',
  handler: ({ actor, params, context }) => startRelief(actor, 'pee', creatureTarget(params.target), context.broadcast),
});
registerAction({
  type: 'bodily.poop_target',
  handler: ({ actor, params, context }) => startRelief(actor, 'poop', creatureTarget(params.target), context.broadcast),
});

// ── `use toilet` / `use sink` panels ─────────────────────────────────────────
// (Previously dead code — commands/bodily.js exported bodilyUseHandler but
// nothing ever called it. Wired here as a self-gated `use` specialized action.)

async function cmdUseToilet(player) {
  const { rows } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND ${TOILET_SQL} LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return undefined;

  const t = rows[0];
  const peeLink   = `<span class="action-link" data-action="pee" data-target="">pee</span>`;
  const poopLink  = `<span class="action-link" data-action="poop" data-target="">poop</span>`;
  const flushLink = `<span class="action-link" data-action="flush" data-target="">flush</span>`;

  let msg = `${t.name}\n${t.description}`;
  msg += `\n<span class="text-dim">Actions:</span> ${peeLink}  ${poopLink}  ${flushLink}`;

  if (isMisActive(player)) {
    msg += `\n<span class="text-dim">The stall offers a moment of total privacy.</span>`;
  }

  return { type:'output', message: msg };
}

async function cmdUseSink(player) {
  const { rows } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND (object_type='sink' OR jsonb_exists(flags,'water_source')) LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return undefined;

  const s = rows[0];
  const washHandsLink = `<span class="action-link" data-action="wash" data-target="hands">wash hands</span>`;
  const washLink      = `<span class="action-link" data-action="wash" data-target="">wash</span>`;

  let msg = `${s.name}\n${s.description}`;
  msg += `\n<span class="text-dim">Actions:</span> ${washHandsLink}  ${washLink}`;

  if (isMisActive(player)) {
    msg += `\n<span class="text-dim">The running water is cold and good for cleaning up after intimate encounters.</span>`;
  }

  return { type:'output', message: msg };
}

async function cmdUseShower(player) {
  const { rows } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND ${SHOWER_SQL} LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return undefined;

  const s = rows[0];
  const showerLink = `<span class="action-link" data-action="shower" data-target="">shower</span>`;

  let msg = `${s.name}\n${s.description}`;
  msg += `\n<span class="text-dim">Actions:</span> ${showerLink}`;
  return { type:'output', message: msg };
}

export const specializedActions = [{
  verb: 'use',
  handler: async (args, raw, player) => {
    const target = args.filter(a => a !== 'on').join(' ').toLowerCase();
    if (!target) return undefined; // bare `use` stays with the inventory builtin
    if (target.includes('toilet')) return cmdUseToilet(player);
    if (target.includes('sink') || target.includes('faucet') || target.includes('tap')) return cmdUseSink(player);
    if (target.includes('shower')) return cmdUseShower(player);
    return undefined;
  },
}];

// `fart` — deliberately, on purpose, in public.
//
// Scales on the same bowel pressure everything else does: barely need to go and
// you get a squeak, genuinely need to go and the room knows about it. The
// cooldown is the only thing stopping it being a spam button, and it's real time
// rather than a resource because the joke is the frequency, not the cost.
//
// It does NOT relieve pressure. You still have to find a toilet.
const FART_COOLDOWN_MS = 5 * 60 * 1000;

// Pushing your luck.
//
// Below the floor there is no risk at all — a fart on a comfortable gut is just
// a fart. Past it you are relying on equipment that is already telling you it
// wants a toilet, and the chance ramps to a coin-flip-ish 45% as you approach
// the involuntary-release ceiling. The player has been getting DIGESTIVE_PRESSURE
// warnings since 80/110, so nobody arrives here uninformed; choosing to fart
// anyway is the gamble, and losing it is the joke.
const FART_RISK_FLOOR = 0.75;   // ~82 of 110 — the same band the urgent messages fire in
const FART_MAX_RISK   = 0.45;

// Exported for the regression suite: the curve matters more than the roll.
export function fartRisk(pressure) {
  const p = Math.max(0, Math.min(1, Number(pressure) || 0));
  if (p <= FART_RISK_FLOOR) return 0;
  return ((p - FART_RISK_FLOOR) / (1 - FART_RISK_FLOOR)) * FART_MAX_RISK;
}

// Which shape this one takes.
//
// The style NAME is a shared vocabulary, like a material token — bodily owns
// when each one can happen (a gameplay rule) and the prose that goes with it,
// the audio generator owns what it sounds like. Neither imports the other, and
// adding a style needs a line in both, which is honest: a new style genuinely
// needs a sound AND something for the room to read.
function rollFlatusStyle(pressure) {
  const ok = Object.keys(FART_STYLE_LINES).filter(k => {
    const l = FART_STYLE_LINES[k];
    return pressure >= (l.min ?? 0) && pressure <= (l.max ?? 1);
  });
  return ok.length ? pick(ok) : 'brassy';
}
const lastFart = new Map(); // playerId -> epoch ms

// The prose follows the SOUND. The audio system rolls a style from the pressure
// (squeak, drone, staccato, silent…) and reports which one it landed on, so the
// line the room reads matches what they just heard instead of being a separate
// random draw that contradicts it.
export const FART_STYLE_LINES = {
  brassy:   { min: 0.2,  max: 1,    self: `You brace, concentrate, and deliver.`,            zone: `{who} farts, with visible commitment.` },
  squeak:   { min: 0,    max: 0.55, self: `It comes out as a thin squeak. Undignified.`,     zone: `{who} emits a small, high squeak.` },
  drone:    { min: 0.5,  max: 1,    self: `It goes on. And on. You wait it out.`,            zone: `{who} produces a long, low note that does not seem to end.` },
  flutter:  { min: 0.3,  max: 1,    self: `A loose, flapping affair. Not your best work.`,   zone: `{who} lets out something loose and flapping.` },
  staccato: { min: 0.35, max: 1,    self: `It arrives in instalments. You count four.`,      zone: `{who} fires off a rapid volley.` },
  falter:   { min: 0.25, max: 0.9,  self: `A false start, a pause, then the real thing.`,    zone: `{who} starts, stops, then commits.` },
  silent:   { min: 0.2,  max: 1,    self: `Almost nothing. The room will find out shortly.`, zone: `{who} shifts their weight, and says nothing.` },
  ripper:   { min: 0.6,  max: 1,    self: `That one had real force behind it.`,              zone: `{who} tears one off with genuine violence.` },
};

async function cmdFart(args, player, broadcast) {
  const now = Date.now();
  const last = lastFart.get(player.id) || 0;
  const left = FART_COOLDOWN_MS - (now - last);
  if (left > 0) {
    const mins = Math.ceil(left / 60000);
    return { type: 'error', message: `You've nothing left in the tank. Give it ${mins} minute${mins === 1 ? '' : 's'}.` };
  }

  const pressure = pressureOf(player.digestive_load);
  lastFart.set(player.id, now);

  // THE GAMBLE. On a gut this full the muscle you are relying on is already
  // failing, and it does not always distinguish between the two jobs.
  const risk = fartRisk(pressure);
  if (risk > 0 && Math.random() < risk) {
    // Reuse the overflow path wholesale — same staining, same public shame, same
    // zeroed meter. A deliberate accident and an involuntary one are the same
    // event; only the reason differs.
    const shame = await involuntaryBowelRelease(player);
    await query('UPDATE players SET digestive_load=$1 WHERE id=$2', [player.digestive_load, player.id]);
    // It still made a noise on the way out.
    emit('bodily.sfx', { zoneId: player.current_zone, playerId: player.id, cue: 'fart', intensity: pressure, style: 'flutter' });
    taintAir(player.current_zone, 'fart');
    return { type: 'output', message: `You commit. It was not only gas.\n${shame}` };
  }

  // Below about a quarter full there is simply nothing to work with, and trying
  // is its own small humiliation.
  const empty = pressure < 0.22;
  // Roll the STYLE here rather than in the audio layer, so the prose and the
  // sound are the same event. The audio plugin is handed the result.
  const style = rollFlatusStyle(empty ? 0.1 : pressure);
  const line = FART_STYLE_LINES[style] || FART_STYLE_LINES.brassy;
  // Getting away with it is the only warning the system gives, and it's enough:
  // the player now knows the risk band exists and roughly where they are in it.
  const closeCall = risk > 0
    ? `\n<span style="color:var(--red)">That was closer than it needed to be. Find a toilet.</span>`
    : '';
  const self = (empty ? `You push. Nothing arrives but a thin, apologetic hiss.` : line.self) + closeCall;

  emit('bodily.sfx', { zoneId: player.current_zone, playerId: player.id, cue: 'fart', intensity: empty ? 0.1 : pressure, style });
  taintAir(player.current_zone, 'fart');
  sendToZone(player.current_zone, {
    type: 'zone_event',
    message: empty
      ? `${player.handle} strains at nothing in particular.`
      : line.zone.replace('{who}', player.handle),
  }, player.id);

  return { type: 'output', message: self };
}

export const commands = {
  fart:     (args, raw, player, broadcast) => cmdFart(args, player, broadcast),
  pee:      (args, raw, player, broadcast) => cmdPee(args, player, broadcast),
  urinate:  (args, raw, player, broadcast) => cmdPee(args, player, broadcast),
  piss:     (args, raw, player, broadcast) => cmdPee(args, player, broadcast),
  poop:     (args, raw, player, broadcast) => cmdPoop(args, player, broadcast),
  defecate: (args, raw, player, broadcast) => cmdPoop(args, player, broadcast),
  shit:     (args, raw, player, broadcast) => cmdPoop(args, player, broadcast),
  flush:    (args, raw, player)            => cmdFlush(args, player),
  shower:   (args, raw, player)            => cmdShower(player),
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const TOILET_PEE_MSGS = [
  `You use the toilet. Relief washes over you.`,
  `You sit down and handle your business. Much better.`,
  `A long, satisfying stream. You feel significantly lighter.`,
];
const TOILET_POOP_MSGS = [
  `You take care of business. A profound sense of relief.`,
  `You use the facilities. The weight of the world, literally, lifts.`,
  `Done. You feel like a new person. Marginally.`,
];
const GROUND_PEE_MSGS = [
  `You relieve yourself on the ground.`,
  `You piss where you stand. No ceremony.`,
  `A long stream hits the concrete. Better out than in.`,
];
const GROUND_POOP_MSGS = [
  `You squat and take care of business on the ground. No one can judge you. (You can judge yourself.)`,
  `You find a spot, crouch, and handle it. Desperate times.`,
  `You take a shit on the ground. The post-singularity hasn't improved this experience.`,
];

const NPC_PEE_YELLS = [
  `What the — are you PISSING on me?! Get away, you animal!`,
  `AGH! Stop! That is disgusting — someone call the enforcers!`,
  `You filthy freak! I'll remember your face!`,
  `Is this a joke to you?! You're urinating on a person!`,
];
const NPC_POOP_YELLS = [
  `Oh god — are you... are you SHITTING on me?! GET OFF!`,
  `This is the worst day of my life. You absolute monster!`,
];

// Bystander disgust at a public elimination (emote form — no name-prefix "says").
const NPC_PEE_WITNESS = [
  `gags and turns away. "Did that freak just piss in the open?!"`,
  `stares in disgust. "There's a whole city and you pick HERE?"`,
  `covers their nose. "Absolutely revolting. Someone report this."`,
  `recoils. "Animals. We're surrounded by animals."`,
];
const NPC_POOP_WITNESS = [
  `retches. "Oh that is VILE — they're actually doing it right there!"`,
  `backs away, horrified. "I did not need to see that. Ever."`,
  `shouts, "Public defecation! Someone call an enforcer!"`,
  `dry-heaves. "The smell. Oh god, the smell."`,
];

const FART_LINES = [
  { self: `A fart escapes you, echoing off the bowl.`,                 zone: `A wet, echoing sound comes from the toilet nearby.` },
  { self: `You let one rip. No dignity in here anyway.`,               zone: `An unmistakable trumpeting noise rings out nearby.` },
  { self: `A long, mournful fart announces your progress.`,            zone: `A long, mournful sound drifts from the direction of the toilet.` },
  { self: `Something squeaks out. You wince.`,                         zone: `A brief squeak carries through the air nearby.` },
];

const DIGESTIVE_PRESSURE = [
  `Your stomach shifts uncomfortably.`,
  `A low gurgling echoes from within you. You ignore it. It doesn't care.`,
  `Something inside you makes its demands known.`,
  `Your gut is sending you a very clear message.`,
  `The pressure building in your abdomen is becoming hard to ignore.`,
];

const HYDRATION_PRESSURE = [
  `You feel increasing internal pressure. Structural.`,
  `A growing sense of urgency develops somewhere you'd rather not think about.`,
  `Your bladder registers a formal complaint.`,
  `The pressure is reaching a point where it's affecting your concentration.`,
  `You really need to find a bathroom soon.`,
];

console.log('[bodily] Plugin loaded.');

// ── Washing somebody else ────────────────────────────────────────────────────
//
// `soap <target>` — the altruistic half of hygiene. Everything else in the system
// is something you do to yourself; this is the one verb that spends your own
// resource on another person's state, which is why it's worth having in a game
// this mean. It needs a water source in the room and a carried item tagged `soap`,
// and it consumes the soap whether the target is a player or an NPC.
//
// No consent gate beyond the obvious: this is help, it removes nothing but filth,
// and it can't be used on anyone hostile to you. A player target is told who did it.
async function consumeSoap(player) {
  const { rows } = await query(
    `SELECT pi.id, pi.quantity FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND jsonb_exists(i.tags, 'soap') LIMIT 1`,
    [player.id]
  );
  if (!rows.length) return false;
  const row = rows[0];
  if (row.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [row.id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [row.id]);
  return true;
}

// Strip the visible filth off a creature (player or NPC) and reset their clock.
async function scrubCreature(target, isPlayer) {
  const ad = target.appearance_data || {};
  ad.soiled_state = null;
  ad.ejaculate_state = null;
  target.appearance_data = ad;
  target.clothing_contamination = {};
  target.covered_in_blood = 0;
  delete target._sweat;
  if (isPlayer) {
    await query(
      `UPDATE players SET appearance_data=$1, clothing_contamination='{}'::jsonb, covered_in_blood=0 WHERE id=$2`,
      [JSON.stringify(ad), target.id]
    ).catch(() => {});
    await markWashed(target);
  } else {
    target._hygieneSince = Date.now();   // NPCs keep hygiene in memory only
  }
}

async function cmdSoap(args, raw, player, broadcast) {
  const nameStr = args.filter(a => !['up', 'down', 'off'].includes(a)).join(' ')
    .replace(/^(the|my)\s+/i, '').trim();

  const { rows: water } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND (${SHOWER_SQL} OR object_type='sink' OR jsonb_exists(flags,'water_source')) LIMIT 1`,
    [player.current_zone]
  );
  if (!water.length) return { type: 'error', message: `You need running water for that.` };

  // No target (or yourself) → the ordinary self-wash, which mis owns.
  if (!nameStr || /^(me|myself|self)$/i.test(nameStr)) return undefined;

  const others = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  const npcs = getZoneNpcs(player.current_zone).filter(n => !n._dead);
  const r = siftResolve(nameStr, [...others.map(p => ({ ...p, name: p.handle })), ...npcs]);
  if (r.type !== 'match') return { type: 'error', message: `Soap who?` };

  const target = r.candidate;
  const isPlayer = others.some(p => p.id === target.id);
  const live = isPlayer ? others.find(p => p.id === target.id) : npcs.find(n => n.id === target.id);
  const name = isPlayer ? live.handle : live.name;

  if (!isPlayer && (live._combatTargetId === player.id || live.flags?.hostile)) {
    return { type: 'error', message: `${name} is in no mood to be washed.` };
  }

  if (!await consumeSoap(player)) {
    return { type: 'error', message: `You have no soap.` };
  }

  await scrubCreature(live, isPlayer);

  // An NPC remembers who did this. It is a small kindness and the substrate is
  // right there — this is one of the cheapest warmth moves in the game.
  if (!isPlayer) adjustRelation(player, live.id, { familiarity: 2, warmth: 6, reason: 'soap' });

  sendToZone(player.current_zone, {
    type: 'zone_event',
    message: `${player.handle} works a block of soap over ${name} until the worst of it comes off.`,
  }, player.id);
  if (isPlayer) {
    sendToPlayer(live.id, { type: 'output', message: `${player.handle} scrubs you down. You come out the other side clean, and oddly moved.` });
  }
  return { type: 'output', message: `You scrub ${name} down. It takes a while, and a whole block of soap, and they look like a different person at the end of it.` };
}

commands.soap  = cmdSoap;
commands.scrub = cmdSoap;

// Declaration-only: a sink or shower advertises SOAP on examine. The verb itself
// stays a command because it self-resolves a creature, which no tag can express.
specializedActions.push({ verb: 'soap', requiredTag: 'water_source', handler: null });
