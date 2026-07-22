// Cooking sessions — timestamp-based like preservation/jail, not a tick.
// A session lives on the food's own player_inventory.custom_data.cooking
// ({ applianceId, startedAt, thawMs, cookMs, doneAt }); a small, bounded set of
// setTimeouts narrate stage transitions and finish the cook, rescheduled from
// the stored timestamps on boot (same pattern as jail's scheduleRelease).
import { query } from '../../server/models/db.js';
import { hasTag } from '../../server/engine/tags.js';
import { getLivePlayer, updateFurniture } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { resolveEnvironment } from '../preservation/decay.js';
import { COOK_SECONDS_PER_KG, THAW_SECONDS_PER_KG, THAW_STAGES, COOK_STAGES, stageText } from './config.js';

const timers = new Map(); // player_inventory id -> [setTimeout handles]

function clearTimers(invId) {
  const t = timers.get(invId);
  if (t) { t.forEach(clearTimeout); timers.delete(invId); }
}

function effectiveTier(env) {
  return env.delivering ? env.tier : env.ambientTier;
}

export function computeDuration(weightGrams, speedMult, isFrozen) {
  const kg = Math.max(0, Number(weightGrams) || 0) / 1000;
  const cookMs = Math.round((kg * COOK_SECONDS_PER_KG / speedMult) * 1000);
  const thawMs = isFrozen ? Math.round((kg * THAW_SECONDS_PER_KG / speedMult) * 1000) : 0;
  return { thawMs, cookMs, totalMs: thawMs + cookMs };
}

// Begin cooking `invRow` (a resolved player_inventory+items row, quantity
// included) at `appliance` ({ id, name, speed, capacityG?, furnitureRow? }).
export async function startCook(invRow, appliance, player) {
  if (!hasTag(invRow, 'needs_cooking')) return { error: `${invRow.name} doesn't need cooking.` };
  const cd = invRow.custom_data || {};
  if (cd.cooked) return { error: `${invRow.name} is already cooked.` };
  if (cd.cooking) return { error: `${invRow.name} is already cooking.` };

  const batchWeight = (invRow.weight || 0) * (invRow.quantity || 1);
  if (appliance.capacityG != null && batchWeight > appliance.capacityG) {
    return { error: `${invRow.name} is too much for the ${appliance.name} — it can only handle small amounts.` };
  }

  const env = await resolveEnvironment(invRow, player);
  const isFrozen = effectiveTier(env) === 'frozen';
  const { thawMs, cookMs, totalMs } = computeDuration(batchWeight, appliance.speed, isFrozen);
  const nowMs = Date.now();
  const session = { applianceId: appliance.id, startedAt: nowMs, thawMs, cookMs, doneAt: nowMs + totalMs };

  await query(
    `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('cooking',$2::jsonb) WHERE id=$1`,
    [invRow.id, JSON.stringify(session)]
  );
  invRow.custom_data = { ...cd, cooking: session };

  if (appliance.furnitureRow) {
    await updateFurniture(appliance.id, { flags: JSON.stringify({ ...appliance.furnitureRow.flags, busy_until: session.doneAt }) });
  }

  scheduleNarration(invRow.id, invRow.player_id, session);

  const frozenNote = isFrozen ? ` — it's frozen solid, this will take a while` : '';
  return { message: `You put ${invRow.name} on the ${appliance.name}${frozenNote}.`, totalMs };
}

// Pure lazy read for examine — no writes, no side effects.
export function checkCooking(invRow) {
  const session = invRow.custom_data?.cooking;
  if (!session) return null;
  const { startedAt, thawMs, cookMs, doneAt } = session;
  const now = Date.now();
  if (now >= doneAt) return { done: true, text: 'cooked through' };
  const elapsed = now - startedAt;
  if (elapsed < thawMs) return { done: false, text: stageText(THAW_STAGES, thawMs > 0 ? elapsed / thawMs : 1) };
  const cookElapsed = elapsed - thawMs;
  return { done: false, text: stageText(COOK_STAGES, cookMs > 0 ? cookElapsed / cookMs : 1) };
}

function scheduleNarration(invId, playerId, session) {
  clearTimers(invId);
  const { startedAt, thawMs, cookMs, doneAt } = session;
  const beats = [];
  if (thawMs > 0) for (const s of THAW_STAGES) beats.push({ at: startedAt + thawMs * s.max, text: s.text });
  for (const s of COOK_STAGES) beats.push({ at: startedAt + thawMs + cookMs * s.max, text: s.text });

  const now = Date.now();
  const handles = [];
  for (const b of beats) {
    const delay = b.at - now;
    if (delay <= 0) continue; // already past this beat — examine shows it live
    handles.push(setTimeout(() => {
      const player = getLivePlayer(playerId);
      if (player) sendToPlayer(playerId, { type: 'output', message: `Whatever's cooking looks ${b.text}.` });
    }, delay));
  }
  handles.push(setTimeout(() => finishCook(invId, playerId).catch(e => console.error('[cooking] finish error:', e.message)), Math.max(0, doneAt - now)));
  timers.set(invId, handles);
}

async function finishCook(invId, playerId) {
  const { rows } = await query(
    `SELECT pi.id, pi.custom_data, i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1`,
    [invId]
  );
  const row = rows[0];
  if (!row || !row.custom_data?.cooking) return; // already finished, moved, or dropped
  await query(
    `UPDATE player_inventory SET custom_data = (COALESCE(custom_data,'{}'::jsonb) - 'cooking') || '{"cooked":true}'::jsonb WHERE id=$1`,
    [invId]
  );
  clearTimers(invId);
  const player = getLivePlayer(playerId);
  if (player) sendToPlayer(playerId, { type: 'output', message: `Your ${row.name} is cooked through and ready to eat.` });
}

// Boot-catchup: reschedule (or immediately finish) any cook session that was
// in flight across a restart, exactly like jail's release-timer recovery.
(async () => {
  const { rows } = await query(
    `SELECT id, player_id, custom_data FROM player_inventory WHERE jsonb_exists(custom_data,'cooking')`
  ).catch(() => ({ rows: [] }));
  for (const r of rows) {
    const session = r.custom_data?.cooking;
    if (!session) continue;
    if (Date.now() >= session.doneAt) await finishCook(r.id, r.player_id).catch(() => {});
    else scheduleNarration(r.id, r.player_id, session);
  }
})().catch(e => console.error('[cooking] boot restore error:', e.message));

export const _test = { clearTimers, finishCook };
