// Cooking sessions — timestamp-based like preservation/jail, not a tick.
// A session lives on the food's own player_inventory.custom_data.cooking
// ({ applianceId, startedAt, thawMs, cookMs, doneAt }); a small, bounded set of
// setTimeouts narrate stage transitions and finish the cook, rescheduled from
// the stored timestamps on boot (same pattern as jail's scheduleRelease).
import { query } from '../../server/models/db.js';
import { hasTag } from '../../server/engine/tags.js';
import { getLivePlayer, updateFurniture, getFurnitureById } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { resolveEnvironment } from '../preservation/decay.js';
import {
  COOK_SECONDS_PER_KG, THAW_SECONDS_PER_KG, THAW_STAGES, COOK_STAGES, stageText, BARE_VESSEL,
  PEAK_LINES, FADING_LINES, lineFor, stagesFor,
} from './config.js';
import { PROFILES } from './profiles.js';
import { portionOf } from './portions.js';
import { timeline, overStageText } from './quality.js';

const timers = new Map(); // player_inventory id -> [setTimeout handles]

function clearTimers(invId) {
  const t = timers.get(invId);
  if (t) { t.forEach(clearTimeout); timers.delete(invId); }
}

function effectiveTier(env) {
  return env.delivering ? env.tier : env.ambientTier;
}

export function computeDuration(weightGrams, speedMult, isFrozen, rateMult = 1) {
  const kg = Math.max(0, Number(weightGrams) || 0) / 1000;
  const cookMs = Math.round((kg * COOK_SECONDS_PER_KG * rateMult / speedMult) * 1000);
  const thawMs = isFrozen ? Math.round((kg * THAW_SECONDS_PER_KG / speedMult) * 1000) : 0;
  return { thawMs, cookMs, totalMs: thawMs + cookMs };
}

// The profile a session was started under. Read from the session, not from the
// item's current tags — a retag mid-cook must not silently change the timeline.
export function sessionProfile(session) {
  return session?.profile ? PROFILES[session.profile] || null : null;
}

// Release the stove a session was holding. Safe to call twice.
export async function freeAppliance(session) {
  if (!session?.applianceId) return;
  const f = await getFurnitureById(session.applianceId);
  if (!f?.flags?.busy_until) return;
  const { busy_until, vessel_id, ...rest } = f.flags;
  await updateFurniture(f.id, { flags: JSON.stringify(rest) }).catch(() => {});
}

// Resolve the thermal environment once for a whole batch. Every item going onto
// the heat together shares a container by construction (they're all in the same
// vessel, or all uncontained), so this is a single read for the batch rather
// than one per ingredient — which is what it used to be.
export function cookEnvironment(sampleRow, player) {
  return resolveEnvironment(sampleRow, player);
}

// Build the session for one item without touching the DB. Returns `{ error }`
// for anything that can't go on the heat, so the caller can report per-item
// problems and still commit the rest of the batch in one write.
export function prepareCook(invRow, appliance, env) {
  // Profiled food may be perfectly edible raw (a tomato, oil, herbs) and still
  // belong on the heat — it's an ingredient. Only unprofiled food that doesn't
  // need cooking has nothing to gain from a stove.
  if (!hasTag(invRow, 'needs_cooking') && !appliance.profileName) {
    return { error: `${invRow.name} doesn't need cooking.` };
  }
  const cd = invRow.custom_data || {};
  if (cd.cooked && !cd.finishable) return { error: `${invRow.name} is already cooked.` };
  if (cd.cooking) return { error: `${invRow.name} is already cooking.` };

  // A portion weighs its fraction of the whole, and cook time follows weight —
  // which is the entire tactical point of chopping.
  const batchWeight = (invRow.weight || 0) * (invRow.quantity || 1) * portionOf(invRow);
  if (appliance.capacityG != null && batchWeight > appliance.capacityG) {
    return { error: `${invRow.name} is too much for the ${appliance.name} — it can only handle small amounts.` };
  }

  const isFrozen = effectiveTier(env) === 'frozen';
  const profileName = appliance.profileName || null;
  const profile = profileName ? PROFILES[profileName] : null;
  const { thawMs, cookMs, totalMs } = computeDuration(batchWeight, appliance.speed, isFrozen, profile?.cookRateMult ?? 1);
  const nowMs = Date.now();
  const session = {
    applianceId: appliance.id, startedAt: nowMs, thawMs, cookMs, doneAt: nowMs + totalMs,
    // Profiled cooks carry the extra context quality evaluation needs. An
    // unprofiled food stores none of it and keeps the original binary behaviour.
    ...(profile ? {
      profile: profileName,
      heatTier: appliance.heatTier || 'low',
      // The burner log. One entry at the start; `stove <setting>` appends. A
      // profile with a heatCurve is scored on this, not on heatTier alone.
      heats: [{ at: nowMs + thawMs, tier: appliance.heatTier || 'low' }],
      vessel: appliance.vessel || BARE_VESSEL,
      vesselName: appliance.vesselName || null,
      acts: [],
      // A smoke is a different process, not a slow cook: it gets an enormous
      // window (you cannot stand over it for an hour) and it changes what the
      // food IS when it comes out.
      ...(appliance.smoking ? { smoking: true } : {}),
    } : {}),
  };

  invRow.custom_data = { ...cd, cooking: session };

  // How long this item alone would hold the stove. The batch takes the longest.
  const holdUntil = profile ? timeline(session, profile).burnAt : session.doneAt;

  const frozenNote = isFrozen ? ` — it's frozen solid, this will take a while` : '';
  const via = appliance.vesselName ? ` in the ${appliance.vesselName}` : '';
  return {
    invId: invRow.id, playerId: invRow.player_id, name: invRow.name, session, holdUntil, totalMs,
    message: `You put ${invRow.name}${via} on the ${appliance.name}${frozenNote}.`,
  };
}

// Commit a whole batch of prepared sessions in ONE statement, then hold the
// stove for the longest of them and schedule each item's narration. A five-
// ingredient stew costs the same two writes as a single steak.
export async function commitCooks(prepared, appliance) {
  if (!prepared.length) return 0;

  await query(
    `UPDATE player_inventory pi
        SET custom_data = COALESCE(pi.custom_data,'{}'::jsonb) || jsonb_build_object('cooking', v.session)
       FROM (SELECT unnest($1::text[]) AS id, unnest($2::jsonb[]) AS session) v
      WHERE pi.id = v.id`,
    [prepared.map(p => p.invId), prepared.map(p => JSON.stringify(p.session))]
  );

  if (appliance.furnitureRow) {
    // A profiled cook holds the stove until it's plated or burns off it, not
    // merely until it's done — the food is still sitting there either way.
    // With staging, a later addition must never SHORTEN an existing hold.
    const holdUntil = Math.max(
      Number(appliance.furnitureRow.flags?.busy_until) || 0,
      ...prepared.map(p => p.holdUntil)
    );
    await updateFurniture(appliance.id, {
      flags: JSON.stringify({ ...appliance.furnitureRow.flags, busy_until: holdUntil, ...(appliance.vesselName ? { vessel_id: appliance.vesselId } : {}) }),
    });
  }

  for (const p of prepared) scheduleNarration(p.invId, p.playerId, p.session, p.name);
  return prepared.length;
}

// Pure lazy read for examine — no writes, no side effects. This is the whole
// telegraph: a profiled cook tells you it's in the window, going, or gone, and
// the player decides when to plate it. Nothing is simulated to answer this.
export function checkCooking(invRow) {
  const session = invRow.custom_data?.cooking;
  if (!session) return null;
  const { startedAt, thawMs, cookMs, doneAt } = session;
  const now = Date.now();
  const profile = sessionProfile(session);
  if (profile && now >= doneAt) {
    const tl = timeline(session, profile);
    return { done: true, burnt: now >= tl.burnAt, text: overStageText(session, profile, now) };
  }
  if (now >= doneAt) return { done: true, text: 'cooked through' };
  const elapsed = now - startedAt;
  if (elapsed < thawMs) return { done: false, text: stageText(THAW_STAGES, thawMs > 0 ? elapsed / thawMs : 1) };
  const cookElapsed = elapsed - thawMs;
  // Per-profile stage prose: a broth ticks and rolls, a cut sizzles and browns.
  return { done: false, text: stageText(stagesFor(session.profile), cookMs > 0 ? cookElapsed / cookMs : 1) };
}

// Every line NAMES the food. With staging a pot can hold three things on three
// different clocks, and an unattributed "it's ready" is useless when you have to
// know which of them it means.
function scheduleNarration(invId, playerId, session, foodName = 'something') {
  clearTimers(invId);
  const { startedAt, thawMs, cookMs, doneAt } = session;
  const profile = sessionProfile(session);
  const beats = [];
  if (thawMs > 0) for (const s of THAW_STAGES) beats.push({ at: startedAt + thawMs * s.max, text: s.text });
  for (const s of stagesFor(session.profile)) beats.push({ at: startedAt + thawMs + cookMs * s.max, text: s.text });

  const now = Date.now();
  const handles = [];
  for (const b of beats) {
    const delay = b.at - now;
    if (delay <= 0) continue; // already past this beat — examine shows it live
    handles.push(setTimeout(() => {
      const player = getLivePlayer(playerId);
      if (player) sendToPlayer(playerId, { type: 'output', message: `The ${foodName} is ${b.text}.` });
    }, delay));
  }

  if (profile) {
    // Profiled food doesn't finish itself — it opens a window, warns you when
    // the window is closing, and burns if you never come back for it. Three
    // timers, all reconstructible from startedAt, none of them a tick.
    const tl = timeline(session, profile);
    handles.push(setTimeout(() => narrate(playerId, `The ${foodName} is ${lineFor(PEAK_LINES, session.profile)}.`), Math.max(0, tl.doneAt - now)));
    handles.push(setTimeout(() => narrate(playerId, `The ${foodName} is ${lineFor(FADING_LINES, session.profile)}.`), Math.max(0, tl.peakEnd - now)));
    handles.push(setTimeout(() => autoPlate(invId, playerId).catch(e => console.error('[cooking] burn error:', e.message)), Math.max(0, tl.burnAt - now)));
  } else {
    handles.push(setTimeout(() => finishCook(invId, playerId).catch(e => console.error('[cooking] finish error:', e.message)), Math.max(0, doneAt - now)));
  }
  timers.set(invId, handles);
}

function narrate(playerId, message) {
  if (getLivePlayer(playerId)) sendToPlayer(playerId, { type: 'output', message });
}

// End a session and stamp the result. `quality` is null for unprofiled food,
// which keeps the original binary cooked flag and nothing else. One row update.
export async function endSession(invId, quality, doneness = null, smoked = null, stayFinishable = false) {
  const stamp = quality ? { cooked: true, cook_quality: quality } : { cooked: true };
  // What you actually produced, not what you asked for.
  if (doneness) stamp.doneness = doneness;
  // A smoked cut changes CLASS: it reads as preserved from here on, which is
  // what lets it walk into every preserved recipe without a new template.
  // A smoked cut is edible AS IS and can still be finished — over coals, in a
  // sauce, in a pot. `finishable` is what lets it go back on heat when
  // everything else that is `cooked` is done being cooked. Cleared by that
  // finish, so a cut can't be re-cooked round and round for a better band.
  if (smoked) {
    stamp.smoked = smoked.profile; stamp.name = smoked.name; stamp.food_noun = smoked.noun;
    stamp.finishable = true;
  } else {
    // A COMPONENT stays finishable after being cooked: browning meatballs is a
    // step, not the meal. Anything else is done once it's done.
    stamp.finishable = !!stayFinishable;
  }
  const { rows } = await query(
    `UPDATE player_inventory
        SET custom_data = (COALESCE(custom_data,'{}'::jsonb) - 'cooking') || $2::jsonb
      WHERE id=$1 AND jsonb_exists(custom_data,'cooking')
      RETURNING id`,
    [invId, JSON.stringify(stamp)]
  );
  clearTimers(invId);
  return rows.length > 0;
}

// Unprofiled food: the original behaviour, unchanged — at doneAt it's simply cooked.
async function finishCook(invId, playerId) {
  const { rows } = await query(
    `SELECT pi.id, pi.custom_data, i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1`,
    [invId]
  );
  const row = rows[0];
  if (!row || !row.custom_data?.cooking) return; // already finished, moved, or dropped
  await freeAppliance(row.custom_data.cooking);
  if (!(await endSession(invId, null))) return;
  narrate(playerId, `Your ${row.name} is cooked through and ready to eat.`);
}

// Profiled food left on the heat past the burn point. Walking away is a choice
// with a result, not a pause — you get a ruined meal, not a perfect one waiting.
async function autoPlate(invId, playerId) {
  const { rows } = await query(
    `SELECT pi.id, pi.custom_data, i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1`,
    [invId]
  );
  const row = rows[0];
  if (!row || !row.custom_data?.cooking) return;
  const profile = sessionProfile(row.custom_data.cooking);
  await freeAppliance(row.custom_data.cooking);
  if (!(await endSession(invId, profile?.targets?.burnt || 'poor'))) return;
  narrate(playerId, `Your ${row.name} has burnt to a ruin. You scrape it off the heat.`);
}

// Boot-catchup: reschedule (or immediately finish) any cook session that was
// in flight across a restart, exactly like jail's release-timer recovery.
(async () => {
  const { rows } = await query(
    `SELECT pi.id, pi.player_id, pi.custom_data, i.name
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE jsonb_exists(pi.custom_data,'cooking')`
  ).catch(() => ({ rows: [] }));
  for (const r of rows) {
    const session = r.custom_data?.cooking;
    if (!session) continue;
    const profile = sessionProfile(session);
    // A profiled cook survives a restart mid-window; only a fully burnt one is
    // resolved on the spot. Everything else re-derives from startedAt.
    if (profile) {
      if (Date.now() >= timeline(session, profile).burnAt) await autoPlate(r.id, r.player_id).catch(() => {});
      else scheduleNarration(r.id, r.player_id, session, r.name);
    } else if (Date.now() >= session.doneAt) await finishCook(r.id, r.player_id).catch(() => {});
    else scheduleNarration(r.id, r.player_id, session, r.name);
  }
})().catch(e => console.error('[cooking] boot restore error:', e.message));

export const _test = { prepareCook, clearTimers, finishCook, autoPlate, freeAppliance };
