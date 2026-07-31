// Cooking sessions — timestamp-based like preservation/jail, not a tick.
// A session lives on the food's own player_inventory.custom_data.cooking
// ({ applianceId, startedAt, thawMs, cookMs, plainDoneAt }); a small, bounded set of
// setTimeouts narrate stage transitions and finish the cook, rescheduled from
// the stored timestamps on boot (same pattern as jail's scheduleRelease).
import { query } from '../../server/models/db.js';
import { hasTag } from '../../server/engine/tags.js';
import { getLivePlayer, updateFurniture, getFurnitureById } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { resolveEnvironment } from '../preservation/decay.js';
import {
  COOK_SECONDS_PER_KG, THAW_SECONDS_PER_KG, MASS_EXPONENT, MIN_COOK_MS, THAW_STAGES, COOK_STAGES, stageText, BARE_VESSEL,
  PEAK_LINES, FADING_LINES, lineFor, stagesFor, MINCE_RATE, MICROWAVE_THAW_SPEED,
} from './config.js';
import { PROFILES } from './profiles.js';
import { portionOf } from './portions.js';
import { prepRateMult, marinadeStrength } from './prep.js';
import { timeline, overStageText, finishAt, evaluate } from './quality.js';
import { markNoisy, clearNoisyKey } from '../../server/engine/sounds.js';
import { emit } from '../../server/engine/events.js';

const timers = new Map(); // player_inventory id -> [setTimeout handles]

// Every cook currently on a burner, in RAM. This exists so that "what is cooking
// in this room" can be answered WITHOUT a query.
//
// It replaced a `jsonb_exists(custom_data,'cooking')` lookup that ran on every
// `smell` — a verb with no cooldown — against a column with no index supporting
// it, which is a sequential scan of the whole player_inventory table per sniff
// over a remote connection. That is exactly the hot-path query the read tiers in
// docs/architecture.md forbid.
//
// Safe to cache because the write funnel is narrow and fully enumerated: a
// session is created in `commitCooks` and destroyed in `endSession` or
// `forgetCook`, and nothing else writes `custom_data.cooking`. Boot catch-up
// repopulates it from the DB, so a restart mid-cook loses nothing.
const liveCooks = new Map(); // player_inventory id -> { applianceId, playerId, name, session, zoneId }
const cooksByAppliance = new Map(); // applianceId -> Set(invId), so a lookup is O(1) not O(all cooks)

function clearTimers(invId) {
  const t = timers.get(invId);
  if (t) { t.forEach(clearTimeout); timers.delete(invId); }
}

// Drop a cook from the runtime entirely — timers and registry. `endSession` is
// the normal route; this is for the paths that delete the row outright instead
// of ending its session (a vessel being plated consumes its contents), which
// previously left both the timers and this registry holding the dead.
export function forgetCook(invId) {
  clearTimers(invId);
  const c = liveCooks.get(invId);
  if (c) {
    const set = cooksByAppliance.get(String(c.applianceId));
    if (set) { set.delete(invId); if (!set.size) cooksByAppliance.delete(String(c.applianceId)); }
  }
  clearNoisyKey(invId);
  liveCooks.delete(invId);
}

// Register a live cook in every index at once, so the three can't drift.
function rememberCook(invId, entry) {
  // Derived, not passed: getFurnitureById is an in-memory Map lookup, and doing
  // it here means the boot restore indexes exactly like a fresh cook does. A
  // portable oven has no furniture row — that cook is simply never marked noisy,
  // which is right, because a carried oven isn't a fixture in the room.
  entry.zoneId = entry.zoneId || getFurnitureById(entry.applianceId)?.zone_id || null;
  liveCooks.set(invId, entry);
  const key = String(entry.applianceId);
  let set = cooksByAppliance.get(key);
  if (!set) cooksByAppliance.set(key, set = new Set());
  set.add(invId);
  // A hot stove is a source of ongoing noise — this is what lets `listen` skip
  // silent zones entirely instead of interrogating each one.
  if (entry.zoneId) markNoisy(entry.zoneId, invId);
}

// What's on these burners right now. Pure in-memory read — no DB, no await.
export function cooksOnAppliances(applianceIds) {
  const out = [];
  for (const id of applianceIds) {
    const set = cooksByAppliance.get(String(id));
    if (!set) continue;
    for (const invId of set) { const c = liveCooks.get(invId); if (c) out.push(c); }
  }
  return out;
}

function effectiveTier(env) {
  return env.delivering ? env.tier : env.ambientTier;
}

export function computeDuration(weightGrams, speedMult, isFrozen, rateMult = 1, thawSpeed = null) {
  const kg = Math.max(0, Number(weightGrams) || 0) / 1000;
  // Heat has to reach the middle, so the clock follows thickness² ∝ m^(2/3), not
  // mass. See MASS_EXPONENT in config.js — 1kg is the fixed point, so the tuned
  // per-kg constants above still mean exactly what they say for a 1kg cut.
  const thermalMass = Math.pow(kg, MASS_EXPONENT);
  // Floored: every quality window is a fraction of cookMs, so a cook shorter than
  // a player can react to has no game in it. See MIN_COOK_MS in config.js.
  // Weightless rows (0g) stay at 0 — that's "nothing to cook", not "a fast cook".
  const rawCookMs = Math.round((thermalMass * COOK_SECONDS_PER_KG * rateMult / speedMult) * 1000);
  const cookMs = rawCookMs > 0 ? Math.max(MIN_COOK_MS, rawCookMs) : 0;
  // Thawing normally rides the same burner speed. A microwave overrides it —
  // defrosting is the single thing it is unambiguously best at, and the gap
  // between it and a hob has to be felt, not implied.
  const thawMs = isFrozen ? Math.round((thermalMass * THAW_SECONDS_PER_KG / (thawSpeed || speedMult)) * 1000) : 0;
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
  // Mince has no structure left to cook through, so it cooks in a third of the
  // time. It pays for that at the ceiling, not the clock (see quality.js).
  const minced = !!cd.minced;
  const rate = (profile?.cookRateMult ?? 1) * prepRateMult(cd);
  const { thawMs, cookMs, totalMs } = computeDuration(batchWeight, appliance.speed, isFrozen, rate,
    appliance.microwave ? MICROWAVE_THAW_SPEED : null);
  const nowMs = Date.now();
  const session = {
    // PLAIN: the finish line with no doneness target applied. For unprofiled
    // food that's the whole story; for profiled food it's a default that
    // `doneness` overrides, so never read it directly — call `finishAt()`.
    applianceId: appliance.id, startedAt: nowMs, thawMs, cookMs, plainDoneAt: nowMs + totalMs,
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
      // Recorded on the session so the quality ladder and the handling verbs both
      // know what this was cooked in, long after the appliance is out of scope.
      ...(appliance.microwave ? { microwave: true } : {}),
      ...(appliance.microwave && appliance.runMs ? { stopAt: nowMs + appliance.runMs } : {}),
      ...(minced ? { minced: true } : {}),
      ...(cd.scored ? { scored: true } : {}),
      ...(cd.tenderised ? { tenderised: true } : {}),
      ...(cd.buttered ? { buttered: true } : {}),
      // The marinade stops working the moment the pan does. Its strength is
      // frozen HERE, at the soak it had earned when the heat came on — not
      // recomputed at plating, or a three-minute soak followed by a long slow
      // cook would collect the full bonus and the whole time cost would be a
      // formality.
      ...(cd.marinated_at ? { marinade: marinadeStrength(invRow, nowMs) } : {}),
    } : {}),
  };

  invRow.custom_data = { ...cd, cooking: session };

  // How long this item alone would hold the stove. The batch takes the longest.
  const holdUntil = profile ? timeline(session, profile).burnAt : finishAt(session);

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

  // The stove's own zone — a portable oven has no furniture row, in which case
  // the cook is silent to the room and simply isn't indexed as noisy.
  const zoneId = appliance.furnitureRow?.zone_id || null;
  for (const p of prepared) {
    rememberCook(p.invId, { applianceId: p.session.applianceId, playerId: p.playerId, name: p.name, session: p.session, zoneId });
    scheduleNarration(p.invId, p.playerId, p.session, p.name);
  }
  return prepared.length;
}

// Pure lazy read for examine — no writes, no side effects. This is the whole
// telegraph: a profiled cook tells you it's in the window, going, or gone, and
// the player decides when to plate it. Nothing is simulated to answer this.
export function checkCooking(invRow) {
  const session = invRow.custom_data?.cooking;
  if (!session) return null;
  const { startedAt, thawMs, cookMs } = session;
  const now = Date.now();
  const profile = sessionProfile(session);
  // A DONENESS TARGET moves the finish line — `rare` lands at 0.75 of the cook,
  // `well done` at 1.35 — so this has to be the same clock the quality ladder
  // uses or examine lies in both directions.
  const tl = profile ? timeline(session, profile) : null;
  const finish = finishAt(session, profile);
  if (profile && now >= finish) {
    return { done: true, burnt: now >= tl.burnAt, text: overStageText(session, profile, now) };
  }
  if (now >= finish) return { done: true, text: 'cooked through' };
  const elapsed = now - startedAt;
  if (elapsed < thawMs) return { done: false, text: stageText(THAW_STAGES, thawMs > 0 ? elapsed / thawMs : 1) };
  const cookElapsed = elapsed - thawMs;
  // The stage prose spans the cook the player actually asked for, so the last
  // stage lands at the moment the window opens rather than at some fixed point
  // before or after it. Per-profile: a broth ticks and rolls, a cut browns.
  const cookSpan = cookMs * (tl?.mult ?? 1);
  return { done: false, text: stageText(stagesFor(session.profile), cookSpan > 0 ? cookElapsed / cookSpan : 1) };
}

// Every line NAMES the food. With staging a pot can hold three things on three
// different clocks, and an unattributed "it's ready" is useless when you have to
// know which of them it means.
function scheduleNarration(invId, playerId, session, foodName = 'something') {
  clearTimers(invId);
  const { startedAt, thawMs, cookMs } = session;
  const profile = sessionProfile(session);
  // Same rule as `checkCooking`: the stage beats have to span the cook that was
  // actually asked for, or a rare steak gets told it's "browning nicely" a full
  // minute after it was warned the window had opened.
  const tl = profile ? timeline(session, profile) : null;
  const cookSpan = cookMs * (tl?.mult ?? 1);
  const beats = [];
  if (thawMs > 0) for (const s of THAW_STAGES) beats.push({ at: startedAt + thawMs * s.max, text: s.text });
  for (const s of stagesFor(session.profile)) beats.push({ at: startedAt + thawMs + cookSpan * s.max, text: s.text });

  const now = Date.now();
  const handles = [];
  for (const b of beats) {
    const delay = b.at - now;
    if (delay <= 0) continue; // already past this beat — examine shows it live
    if (tl && b.at >= tl.doneAt) continue; // the window has opened; the peak line owns it now
    handles.push(setTimeout(() => {
      const player = getLivePlayer(playerId);
      if (player) sendToPlayer(playerId, { type: 'output', message: `The ${foodName} is ${b.text}.` });
    }, delay));
  }

  if (profile && session.microwave && session.stopAt) {
    // A microwave owns its own ending. One timer, not three: it stops when the
    // dial says so and there is no window to miss and nothing to burn.
    handles.push(setTimeout(() => finishMicrowave(invId, playerId).catch(e => console.error('[cooking] microwave error:', e.message)),
      Math.max(0, session.stopAt - now)));
  } else if (profile) {
    // Profiled food doesn't finish itself — it opens a window, warns you when
    // the window is closing, and burns if you never come back for it. Three
    // timers, all reconstructible from startedAt, none of them a tick.
    handles.push(setTimeout(() => narrate(playerId, `The ${foodName} is ${lineFor(PEAK_LINES, session.profile)}.`), Math.max(0, tl.doneAt - now)));
    handles.push(setTimeout(() => narrate(playerId, `The ${foodName} is ${lineFor(FADING_LINES, session.profile)}.`), Math.max(0, tl.peakEnd - now)));
    handles.push(setTimeout(() => autoPlate(invId, playerId).catch(e => console.error('[cooking] burn error:', e.message)), Math.max(0, tl.burnAt - now)));
  } else {
    handles.push(setTimeout(() => finishCook(invId, playerId).catch(e => console.error('[cooking] finish error:', e.message)), Math.max(0, finishAt(session) - now)));
  }
  timers.set(invId, handles);
}

// Rebuild a live session's timers after something moved its clock. `doneness`
// is the only thing that can: asking for `well done` pushes the finish line out
// to 1.35× the cook, and the burn timer scheduled against the OLD target would
// otherwise fire in the middle of the new peak window and auto-burn a steak
// that was doing nothing wrong.
export function rescheduleNarration(invId, playerId, session, foodName) {
  scheduleNarration(invId, playerId, session, foodName);
}

// A microwave reaching the end of its timer. It stops — no burning on past the
// window like a hob, because the magnetron is off. Whatever quality the food had
// reached at that instant is the quality you get, which is what makes setting
// the time the actual skill.
async function finishMicrowave(invId, playerId) {
  const { rows } = await query(
    `SELECT pi.id, pi.custom_data, i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1`,
    [invId]
  );
  const row = rows[0];
  if (!row?.custom_data?.cooking) return;
  const session = row.custom_data.cooking;
  const profile = sessionProfile(session);
  await freeAppliance(session);
  const band = profile ? evaluate(session, profile, Date.now(), 0).band : null;
  if (!(await endSession(invId, band))) return;
  const zoneId = liveCooks.get(invId)?.zoneId;
  emit('cooking.sfx', { zoneId, playerId, action: 'microwave', state: 'done' });
  narrate(playerId, `The ${row.name} is done. The microwave beeps three times and stops.`);
}

function narrate(playerId, message) {
  if (getLivePlayer(playerId)) sendToPlayer(playerId, { type: 'output', message });
}

// End a session and stamp the result. `quality` is null for unprofiled food,
// which keeps the original binary cooked flag and nothing else. One row update.
export async function endSession(invId, quality, doneness = null, smoked = null, stayFinishable = false, extra = {}) {
  const stamp = quality ? { cooked: true, cook_quality: quality, ...extra } : { cooked: true, ...extra };
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
  // Prep is SPENT by the cook it was done for. It has already been read into the
  // session and scored, so leaving the flags on the finished item would let a
  // `finishable` component (a browned meatball, a smoked cut) collect the same
  // marinade a second time on its way through the next pan — and would have
  // `examine` still describing a plated steak as sitting in a marinade.
  const { rows } = await query(
    `UPDATE player_inventory
        SET custom_data = (COALESCE(custom_data,'{}'::jsonb)
              - 'cooking' - 'scored' - 'tenderised' - 'marinated_at' - 'tasted') || $2::jsonb
      WHERE id=$1 AND jsonb_exists(custom_data,'cooking')
      RETURNING id`,
    [invId, JSON.stringify(stamp)]
  );
  forgetCook(invId);
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
    // Anything still live goes back in the registry as well as back on a timer —
    // otherwise a restart would leave a pot visibly on the heat that `smell`
    // could no longer find.
    const restore = () => {
      rememberCook(r.id, { applianceId: session.applianceId, playerId: r.player_id, name: r.name, session });
      scheduleNarration(r.id, r.player_id, session, r.name);
    };
    if (profile) {
      // A microwave whose timer elapsed during the restart just finishes — it
      // stopped when the dial said so, whether or not the server was up.
      if (session.microwave && session.stopAt) {
        if (Date.now() >= session.stopAt) await finishMicrowave(r.id, r.player_id).catch(() => {});
        else restore();
      }
      else if (Date.now() >= timeline(session, profile).burnAt) await autoPlate(r.id, r.player_id).catch(() => {});
      else restore();
    } else if (Date.now() >= finishAt(session)) await finishCook(r.id, r.player_id).catch(() => {});
    else restore();
  }
})().catch(e => console.error('[cooking] boot restore error:', e.message));

export const _test = { prepareCook, clearTimers, finishCook, autoPlate, freeAppliance };
