// Jail — get downed while WANTED and the cops scrape you up instead of the
// cloning vat. You wake in Precinct 9's holding cell, gear confiscated, and do
// 1 minute per wanted star. A guard then walks you out to the lobby and hands
// back your legal property; contraband (weapons/drugs/hacking decks) is logged to
// a shared police evidence locker and never returned. The cell door is a very
// high-difficulty hololock — breaking out is a jailbreak (heat comes back) and
// forfeits everything the police were holding.
//
// Integration seams (no engine coupling beyond the hook):
//   - engine `player.respawnZone` hook: diverts respawn to the cell + skips the
//     lootable corpse (gameLoop.handlePlayerDeath), while inventory is intact so
//     we can confiscate rather than drop.
//   - `zone.entered` event: leaving the cell any other way = escape.
//   - actions: TELEPORT (release), WANTED_RAISE (surveillance, on jailbreak).
// See docs/systems-jail.md.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { world, getZone, getLivePlayer, getMinimapData } from '../../server/engine/world.js';
import { getFlag } from '../../server/engine/flags.js';
import { on } from '../../server/engine/events.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { getBroadcast, sendToPlayer } from '../../server/engine/messaging.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { moveEntity } from '../../server/engine/ai-behaviour.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { schedule } from '../../server/engine/scheduler.js';

const CELL_ZONE = 'zone_mq_precinct_holding';   // the holding cell you wake in
const RELEASE_ZONE = 'zone_mq_precinct_lobby';  // where the guard walks you out to
const BUNK_ZONE = 'zone_mq_precinct_bullpen';   // where off-shift officers wait (their desks)
const MINUTE = 60 * 1000;
const EVIDENCE_CAP = 50;                         // max rows in the shared locker
const PURGE_MS = 3 * 24 * 60 * 60 * 1000;        // wipe evidence older than 3 days
const FINE_PER_HALF_STAR = 50;                   // ₵ booking fine per half wanted-star

// Duty roster, in shift order: officer[0] works 00:00–08:00, [1] 08:00–16:00,
// [2] 16:00–24:00 (game time runs 1:1 with real time, so a shift = 8 real hours).
// Kohl is the pre-existing detention officer; the other two are seeded by
// scripts/create-jail-officers.js. Off-duty officers wait in the bullpen.
const OFFICERS = ['npc_precinct_guard', 'npc_precinct_officer_2', 'npc_precinct_officer_3'];

// Lines the on-duty officer says as they walk you out at the end of your stretch.
const RELEASE_LINES = [
  `"Time's served. Try to make it a week this time."`,
  `"Sobered up? Good. The door's that way — don't make me see you again."`,
  `"You're free to go. Your file says otherwise, but that's tomorrow's problem."`,
  `"Up. Out. Sign for your things at the desk and stay off the cameras."`,
  `"Congratulations, you're rehabilitated. Statistically, for about six hours."`,
  `"On your feet. The city's forgotten you already — do it a favor and stay forgotten."`,
];

const timers = new Map();       // playerId -> release setTimeout handle
const releasing = new Set();    // playerIds mid-release (suppress escape detection)

// ── Confiscation ─────────────────────────────────────────────────────────────
// An item is contraband if it's a weapon, a drug, or a hacking deck. Quest items
// are never taken (they'd soft-lock a quest — same carve-out spawnPlayerCorpse makes).
// Gated on the `hack_device` capability tag (see tagCatalog.js), not a specific id.
function isContraband(itemId, tags) {
  return ('weapon' in tags) || ('drug' in tags) || ('hack_device' in tags);
}

// Bag confiscated contraband into the shared evidence locker, then evict the
// oldest rows past the 50-item cap.
async function lockUp(items, handle) {
  for (const it of items) {
    await query(
      `INSERT INTO police_evidence (id, item_id, quantity, condition, custom_data, source_handle)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), it.item_id, it.quantity, it.condition, JSON.stringify(it.custom_data || {}), handle || null]
    );
  }
  if (items.length) {
    await query(
      `DELETE FROM police_evidence WHERE id IN (
         SELECT id FROM police_evidence ORDER BY created_at DESC OFFSET $1)`,
      [EVIDENCE_CAP]
    );
  }
}

// Strip everything off the player: contraband → evidence, the rest → held snapshot
// (returned on release). Runs from the respawn hook while inventory is still intact.
async function confiscate(playerId, handle) {
  const { rows } = await query(
    `SELECT pi.item_id, pi.quantity, pi.condition, pi.is_equipped, pi.slot, pi.layer,
            pi.custom_data, pi.container_id, i.tags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1`,
    [playerId]
  );
  const held = [], contraband = [];
  for (const r of rows) {
    const tags = r.tags || {};
    if (tags.quest_item === true) continue;   // stays on the player
    const snap = {
      item_id: r.item_id, quantity: r.quantity, condition: r.condition,
      is_equipped: r.is_equipped, slot: r.slot, layer: r.layer,
      custom_data: r.custom_data || {}, container_id: r.container_id,
    };
    (isContraband(r.item_id, tags) ? contraband : held).push(snap);
  }
  // Remove all non-quest items from the player (quest items left untouched).
  await query(
    `DELETE FROM player_inventory pi USING items i
      WHERE i.id = pi.item_id AND pi.player_id = $1
        AND NOT (i.tags @> '{"quest_item":true}')`,
    [playerId]
  );
  await lockUp(contraband, handle);
  return held;
}

// Wipe whatever the player is carrying (prison garb) and restore the held snapshot.
async function restoreHeld(playerId, held) {
  const items = Array.isArray(held) ? held : [];
  await query('DELETE FROM player_inventory WHERE player_id = $1', [playerId]);
  for (const it of items) {
    await query(
      `INSERT INTO player_inventory
         (id, player_id, item_id, quantity, condition, is_equipped, slot, layer, custom_data, container_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [randomUUID(), playerId, it.item_id, it.quantity ?? 1, it.condition ?? 1.0,
       it.is_equipped ?? 0, it.slot ?? null, it.layer ?? 1,
       JSON.stringify(it.custom_data || {}), it.container_id ?? null]
    );
  }
}

// ── Timers ───────────────────────────────────────────────────────────────────
function clearTimer(playerId) {
  const t = timers.get(playerId);
  if (t) { clearTimeout(t); timers.delete(playerId); }
}
function scheduleRelease(playerId, ms) {
  clearTimer(playerId);
  timers.set(playerId, setTimeout(() => {
    timers.delete(playerId);
    release(playerId).catch(e => console.error('[jail] release error:', e.message));
  }, Math.max(0, ms)));
}

// ── Duty roster / shifts ─────────────────────────────────────────────────────
// The officer on duty right now, by the in-game hour (three 8-hour shifts).
function onDutyOfficerId() {
  const hour = getEnvironmentState().hour ?? 0;   // 0–23
  return OFFICERS[Math.floor(hour / 8) % OFFICERS.length];
}

// Keep exactly the on-duty officer in the lobby and the rest in the bunk room.
// Idempotent — moveEntity no-ops (and stays silent) when an officer is already
// in place, so this is cheap to run every minute and safe against boot ordering.
function syncShift() {
  const bc = getBroadcast();
  if (typeof bc !== 'function') return;   // broadcast not wired yet (or headless test harness)
  const dutyId = onDutyOfficerId();
  for (const id of OFFICERS) {
    const npc = world.npcs.get(id);
    if (!npc || npc._dead) continue;
    const dest = id === dutyId ? RELEASE_ZONE : BUNK_ZONE;
    if (npc.zone_id !== dest) moveEntity(npc, dest, bc, query);
  }
}

// ── Jailing (the respawn hook) ───────────────────────────────────────────────
async function onRespawnZone(player, killer) {
  const current = parseFloat(await getFlag('player', 'wanted', player) || '0') || 0;
  // Book on the PEAK heat of this spree, not the current (possibly decayed) level:
  // run 5★ and whittle it down to ½★ and you're still charged for the full 5★.
  let wanted = current;
  try {
    const r = await dispatchAction({ type: 'WANTED_PEAK', actor: player });
    if (typeof r?.peak === 'number') wanted = Math.max(wanted, r.peak);
  } catch { /* surveillance not loaded — fall back to the current flag */ }
  const stars = Math.floor(wanted);
  if (stars < 1) return undefined;  // clean death → normal clone-vat respawn

  // Booking fine — ₵50 per half wanted-star. Debt is allowed (an owed fine), so
  // bypass adjustCredits (which clamps at zero) with a direct un-clamped debit.
  const halfStars = Math.round(wanted / 0.5);
  const fine = halfStars * FINE_PER_HALF_STAR;
  let balance = player.credits ?? 0;
  if (fine > 0) {
    const res = await query('UPDATE players SET credits = credits - $1 WHERE id = $2 RETURNING credits',
      [fine, player.id]).catch(() => null);
    if (res?.rows[0]) { balance = res.rows[0].credits; player.credits = balance; }
  }

  // Rap sheet for the booking record — read now, while surveillance still holds
  // it (it clears the suspect's heat later in this same death, at player.death).
  let charges = [];
  try {
    const r = await dispatchAction({ type: 'WANTED_CHARGES', actor: player });
    if (Array.isArray(r?.charges)) charges = r.charges;
  } catch { /* surveillance not loaded — fall back below */ }
  const charge = charges.length ? charges.join(', ') : 'multiple outstanding warrants';

  // Everything the cops take (contraband → evidence, the rest held for release).
  const confiscated = (await query(
    `SELECT COUNT(*)::int AS n FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND NOT (i.tags @> '{"quest_item":true}')`,
    [player.id]
  ).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;

  const held = await confiscate(player.id, player.handle);
  const ms = stars * MINUTE;
  await query(
    `INSERT INTO jail_prisoners (player_id, cell_zone, release_zone, release_at, stars, held_items)
     VALUES ($1,$2,$3, NOW() + ($4 || ' milliseconds')::interval, $5,$6)
     ON CONFLICT (player_id) DO UPDATE SET
       cell_zone=$2, release_zone=$3, release_at=NOW() + ($4 || ' milliseconds')::interval,
       stars=$5, held_items=$6, created_at=NOW()`,
    [player.id, CELL_ZONE, RELEASE_ZONE, String(ms), stars, JSON.stringify(held)]
  );
  scheduleRelease(player.id, ms);

  const mins = stars === 1 ? '1 minute' : `${stars} minutes`;
  // Booking record popup + keep the wanted HUD showing your stars (it decays over
  // the sentence via the minute tick). Deferred so it lands after the death/
  // respawn render and after surveillance zeroes the HUD at player.death.
  setTimeout(() => {
    sendToPlayer(player.id, {
      type: 'arrest_notice',
      charge, stars, sentence: mins, confiscated, fine, balance,
    });
    sendToPlayer(player.id, { type: 'wanted_level', stars });
  }, 700);

  const message = `<span class="clone-vat-message">You come to on a steel bench in Precinct 9's holding block — wrists zip-tied, pockets empty, a charge sheet taped to the bars. The desk sergeant doesn't look up: "${mins}. Sit tight." Anything the law calls contraband has been logged to evidence; you won't be seeing that again.</span>`;
  return { zone: CELL_ZONE, message };
}

// ── Release (guard walks you out) ────────────────────────────────────────────
async function release(playerId) {
  const { rows } = await query('SELECT * FROM jail_prisoners WHERE player_id = $1', [playerId]);
  const rec = rows[0];
  if (!rec) return;
  clearTimer(playerId);
  releasing.add(playerId);
  try {
    await query('DELETE FROM jail_prisoners WHERE player_id = $1', [playerId]);
    await restoreHeld(playerId, rec.held_items);

    const player = getLivePlayer(playerId);
    if (player) {
      const bc = getBroadcast();
      // The officer on duty right now walks into the cell, says their piece, and
      // walks only the prisoner out — the lock re-engages behind, so no cellmate
      // slips through. Their name is whoever's shift it is.
      const officer = world.npcs.get(onDutyOfficerId());
      const officerName = officer?.name || 'The duty officer';
      const line = RELEASE_LINES[Math.floor(Math.random() * RELEASE_LINES.length)];
      // Clear the countdown HUD — you walk out clean.
      sendToPlayer(playerId, { type: 'wanted_level', stars: 0 });
      bc?.(rec.cell_zone, {
        type: 'zone_event',
        message: `<span class="text-yellow">${officerName} steps into the cell, keys jangling. "${player.handle}. ${line}"</span> The door buzzes open just long enough to walk ${player.handle} out, then clanks shut and re-locks behind them.`,
      }, playerId);
      await dispatchAction({ type: 'TELEPORT', actor: player, params: { zone_id: rec.release_zone }, context: { broadcast: bc } });
      const zone = getZone(rec.release_zone);
      if (zone) sendToPlayer(playerId, { type: 'move', message: await describeZone(zone, player), zone: rec.release_zone, minimap: getMinimapData(rec.release_zone) });
      sendToPlayer(playerId, { type: 'output', message: `<span class="msg-system">${officerName} slides a plastic tub across the counter — your things, minus anything the law keeps. "Stay out of trouble."</span>` });
    } else {
      // Offline (e.g. released at boot after the deadline passed) — DB-only move.
      await query('UPDATE players SET current_zone = $1 WHERE id = $2', [rec.release_zone, playerId]);
    }
  } finally {
    releasing.delete(playerId);
  }
}

// ── Escape (any exit from the cell that isn't the guard) ─────────────────────
async function escape(player) {
  const { rows } = await query('SELECT * FROM jail_prisoners WHERE player_id = $1', [player.id]);
  const rec = rows[0];
  if (!rec) return;
  clearTimer(player.id);
  await query('DELETE FROM jail_prisoners WHERE player_id = $1', [player.id]);
  // Skipped processing — the legal gear the desk was holding gets bagged into
  // evidence too. Nothing comes back.
  await lockUp(Array.isArray(rec.held_items) ? rec.held_items : [], player.handle);
  // Breaking out is a fresh crime: the heat you shed on arrest comes roaring back.
  await dispatchAction({ type: 'WANTED_RAISE', actor: player, params: { amount: rec.stars, reason: 'a jailbreak' } });
  sendToPlayer(player.id, { type: 'output', message: `<span class="text-red">You're out — but the cell logged the breach. Your file is active again, and everything the police were holding is gone into evidence.</span>` });
  getBroadcast()?.(rec.cell_zone, { type: 'zone_event', message: 'An alarm strobes over the empty cell — someone bypassed the lock.' }, player.id);
}

on('zone.entered', async ({ actor, zone }) => {
  if (!actor?.id || releasing.has(actor.id) || zone === CELL_ZONE) return;
  const { rows } = await query('SELECT 1 FROM jail_prisoners WHERE player_id = $1', [actor.id]);
  if (rows.length) await escape(actor).catch(e => console.error('[jail] escape error:', e.message));
});

// ── Minute tick: rotate shifts + decay the prison countdown HUD ──────────────
// Your wanted stars ride the sentence down: each minute the HUD shows the stars
// still left to serve (ceil of the remaining time), so it visibly declines and
// hits zero right as the officer walks you out. Purely a HUD countdown — your
// actual street heat was cleared on arrest.
schedule('1m', async () => {
  syncShift();
  const { rows } = await query('SELECT player_id, release_at, stars FROM jail_prisoners').catch(() => ({ rows: [] }));
  const now = Date.now();
  for (const r of rows) {
    if (!getLivePlayer(r.player_id)) continue;
    const remaining = Math.max(0, Math.min(r.stars, Math.ceil((new Date(r.release_at).getTime() - now) / MINUTE)));
    sendToPlayer(r.player_id, { type: 'wanted_level', stars: remaining });
  }
});

// ── Evidence purge ───────────────────────────────────────────────────────────
async function purgeEvidence() {
  await query(`DELETE FROM police_evidence WHERE created_at < NOW() - $1::interval`, [`${PURGE_MS} milliseconds`]).catch(() => {});
}
setInterval(() => purgeEvidence(), 60 * 60 * 1000);

// ── Boot: reschedule / catch up on any prisoners across a restart ────────────
(async () => {
  const { rows } = await query('SELECT player_id, release_at FROM jail_prisoners').catch(() => ({ rows: null }));
  if (!rows) return;   // table not migrated yet — jailing will surface it
  for (const r of rows) {
    const ms = new Date(r.release_at).getTime() - Date.now();
    if (ms <= 0) await release(r.player_id).catch(e => console.error('[jail] boot release error:', e.message));
    else scheduleRelease(r.player_id, ms);
  }
})().catch(e => console.error('[jail] boot restore error:', e.message));

// Place the duty roster once the world has loaded (the minute tick maintains it).
setTimeout(() => { try { syncShift(); } catch (e) { console.error('[jail] shift sync error:', e.message); } }, 5000);

export const hooks = { 'player.respawnZone': onRespawnZone };

// Exposed for the regression harness.
export const _test = { confiscate, restoreHeld, release, escape, onRespawnZone, isContraband, onDutyOfficerId, OFFICERS, CELL_ZONE, RELEASE_ZONE, BUNK_ZONE };

console.log('[jail] Plugin loaded.');
