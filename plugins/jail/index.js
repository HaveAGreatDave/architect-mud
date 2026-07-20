// Jail — get downed while WANTED and the cops scrape you up instead of the
// cloning vat. You wake in Precinct 9's holding cell, gear confiscated, and do
// 1 base-minute per wanted star, scaled up by the world clock (so at 3× a 5★
// stretch is 15 real minutes). A guard then walks you out to the lobby and hands
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
import { world, getZone, getLivePlayer, getMinimapData, getDoorById, getZoneDoors, setDoorCache } from '../../server/engine/world.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { getFlag } from '../../server/engine/flags.js';
import { skillCheck, effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { on, emit } from '../../server/engine/events.js';
import { dispatchAction, registerAction } from '../../server/engine/actions.js';
import { getBroadcast, sendToPlayer } from '../../server/engine/messaging.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { moveEntity } from '../../server/engine/ai-behaviour.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { schedule } from '../../server/engine/scheduler.js';
import { gameMsToReal, realMsToGame, getTimeScale } from '../../server/engine/gametime.js';
import { getTunable } from '../../server/engine/tunables.js';

// Global scalar on booking fines AND jail time. Default 6 (penalties are 6× the old
// baseline); dev-editable in the Crime panel via the `crime_penalty_multiplier` tunable.
const penaltyMult = () => Math.max(0, Number(getTunable('crime_penalty_multiplier', 6)) || 6);

const CELL_ZONE = 'zone_mq_precinct_holding';   // the holding cell you wake in
const RELEASE_ZONE = 'zone_mq_precinct_lobby';  // where the guard walks you out to
const BUNK_ZONE = 'zone_mq_precinct_bullpen';   // where off-shift officers wait (their desks)
const PRISON_JUMPSUIT = 'item_prison_jumpsuit'; // issued at booking (torso+legs, via its `covers` tag)
const MINUTE = 60 * 1000;
const EVIDENCE_CAP = 50;                         // max rows in the shared locker
const PURGE_MS = 3 * 24 * 60 * 60 * 1000;        // wipe evidence older than 3 days
const FINE_PER_HALF_STAR = 50;                   // ₵ booking fine per half wanted-star

// ── Conceal / search tuning ──────────────────────────────────────────────────
// Contraband can be hidden from a search two ways: proactively (`conceal <item>`,
// a Deception stash that the scanner then rolls against) or reactively (a live
// scan-sweep palm the instant you're searched). Both mark the inventory row's
// custom_data.concealed; confiscate() honors it.
const SCAN_DIFFICULTY = 6;        // Deception target the scanner sets for a *proactively* stashed item
const PALM_MAX_WEIGHT = 3;        // only small contraband can be palmed/stashed (no rifles up a sleeve)
const CONCEAL_DIFFICULTY = 5;     // Deception target for the proactive `conceal` stash
const CONCEAL_TIMEOUT_MS = 20000; // if the palm minigame never resolves, book anyway (everything given up)

// A contraband item small enough to slip up a sleeve or into a waistband.
function isPalmable(tags, weight) {
  return isContraband(null, tags || {}) && (Number(weight) || 0) <= PALM_MAX_WEIGHT;
}

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
  return ('weapon' in tags) || ('drug' in tags) || ('hack_device' in tags) || ('contraband' in tags);
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
// (returned on release). Concealed contraband gets a shot at slipping through —
// a live palm (custom_data.concealed.palmed) is a guaranteed keep this search; a
// proactive stash rolls Deception vs the scanner. Survivors stay on the player,
// hidden. Runs while inventory is still intact (respawn hook or a live arrest).
// `actor` (a live player) is needed only to roll a proactive stash; when absent
// (the regress harness passes a synthetic id) concealment simply can't hide.
async function confiscate(playerId, handle, actor = null) {
  const { rows } = await query(
    `SELECT pi.id AS inv_id, pi.item_id, pi.quantity, pi.condition, pi.is_equipped, pi.slot, pi.layer,
            pi.custom_data, pi.container_id, i.tags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1`,
    [playerId]
  );
  const held = [], contraband = [], survivedIds = [];
  const who = actor || getLivePlayer(playerId);
  for (const r of rows) {
    const tags = r.tags || {};
    if (tags.quest_item === true) continue;   // stays on the player
    const cd = r.custom_data || {};
    if (cd.packaged) { survivedIds.push(r.inv_id); continue; }   // sealed climate crate — tamper-proof, survives the search
    const con = isContraband(r.item_id, tags);
    if (con && cd.concealed && who) {
      let keep = cd.concealed.palmed === true;                       // a clean live palm always holds
      if (!keep) { const chk = await skillCheck(who, 'deception', SCAN_DIFFICULTY); keep = chk.success; }
      if (keep) { survivedIds.push(r.inv_id); continue; }            // slipped through — stays on the player
    }
    const snap = {
      item_id: r.item_id, quantity: r.quantity, condition: r.condition,
      is_equipped: r.is_equipped, slot: r.slot, layer: r.layer,
      custom_data: cd, container_id: r.container_id,
    };
    (con ? contraband : held).push(snap);
  }
  // Remove all non-quest items EXCEPT any that beat the search (quest items untouched).
  await query(
    `DELETE FROM player_inventory pi USING items i
      WHERE i.id = pi.item_id AND pi.player_id = $1
        AND NOT (i.tags @> '{"quest_item":true}')
        AND pi.id <> ALL($2::text[])`,
    [playerId, survivedIds]
  );
  await lockUp(contraband, handle);
  return held;
}

// Issue the prison jumpsuit and put it on. Worn on the torso; its `covers` tag
// (see items) fills the legs from the same single garment, so a stripped prisoner
// isn't left half-naked. Removed automatically at release — restoreHeld() wipes
// the whole inventory (garb included) before restoring the held snapshot.
async function dressInGarb(playerId) {
  // Insert-if-present: a booking never hinges on the garb item being seeded, so a
  // world without item_prison_jumpsuit (e.g. the regress harness) just skips it.
  await query(
    `INSERT INTO player_inventory (id, player_id, item_id, quantity, is_equipped, slot, layer)
     SELECT $1,$2,$3,1,1,'torso',2 WHERE EXISTS (SELECT 1 FROM items WHERE id=$3)`,
    [randomUUID(), playerId, PRISON_JUMPSUIT]
  );
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

// ── Booking (shared by the down-and-out respawn hook AND a live non-lethal arrest) ─
// Books the player into Precinct 9: fine, confiscation, sentence, release timer,
// booking popup. `teleport:false` (the death path) just returns {zone,message} for
// the engine to respawn them; `teleport:true` (a cop apprehending you at ≤3.5★, no
// death) walks them to the cell itself and clears their street heat (no player.death
// fires to do it). Returns { booked, zone, message }.
async function bookIntoCell(player, { teleport = false } = {}) {
  const current = parseFloat(await getFlag('player', 'wanted', player) || '0') || 0;
  // Book on the PEAK heat of this spree, not the current (possibly decayed) level:
  // run 5★ and whittle it down to ½★ and you're still charged for the full 5★.
  let wanted = current;
  try {
    const r = await dispatchAction({ type: 'WANTED_PEAK', actor: player });
    if (typeof r?.peak === 'number') wanted = Math.max(wanted, r.peak);
  } catch { /* surveillance not loaded — fall back to the current flag */ }
  const stars = Math.floor(wanted);
  if (stars < 1) return { booked: false };  // clean → normal respawn / no arrest

  // Booking fine — ₵50 per half wanted-star, collected on RELEASE. The desk empties
  // your pockets now: all on-hand cash is held (with your gear) and returned at
  // release minus the fine. A fine bigger than what you were carrying leaves you
  // owing (debt allowed). Escaping forfeits the held cash along with the gear.
  const mult = penaltyMult();
  const halfStars = Math.round(wanted / 0.5);
  const fine = Math.round(halfStars * FINE_PER_HALF_STAR * mult);
  const cap = await query('SELECT credits FROM players WHERE id = $1', [player.id]).catch(() => null);
  const heldCredits = cap?.rows[0]?.credits ?? player.credits ?? 0;
  await query('UPDATE players SET credits = 0 WHERE id = $1', [player.id]).catch(() => {});
  player.credits = 0;

  // Rap sheet for the booking record — read now, while surveillance still holds it.
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

  const held = await confiscate(player.id, player.handle, player);
  await dressInGarb(player.id);   // stripped and re-clothed in a Precinct 9 jumpsuit
  // Sentence is stars base-minutes, scaled UP by the game-speed knob so a faster
  // world clock means a proportionally longer lockout (at 3× a 5★ stretch is 15
  // real minutes). release_at + the release timer both use this real duration.
  const ms = realMsToGame(stars * MINUTE * mult);
  await query(
    `INSERT INTO jail_prisoners (player_id, cell_zone, release_zone, release_at, stars, held_items, held_credits, fine)
     VALUES ($1,$2,$3, NOW() + ($4 || ' milliseconds')::interval, $5,$6,$7,$8)
     ON CONFLICT (player_id) DO UPDATE SET
       cell_zone=$2, release_zone=$3, release_at=NOW() + ($4 || ' milliseconds')::interval,
       stars=$5, held_items=$6, held_credits=$7, fine=$8, created_at=NOW()`,
    [player.id, CELL_ZONE, RELEASE_ZONE, String(ms), stars, JSON.stringify(held), heldCredits, fine]
  );
  scheduleRelease(player.id, ms);

  // Label the sentence in the real minutes actually served (base stars × the
  // world-clock scale), so the desk sergeant and booking notice don't undersell it.
  const realMins = Math.max(1, Math.round(stars * mult * getTimeScale()));
  const mins = realMins === 1 ? '1 minute' : `${realMins} minutes`;
  // Booking record popup + keep the wanted HUD showing your stars (it decays over
  // the sentence via the minute tick). Deferred so it lands after the render and
  // after any HUD-zeroing (death, or WANTED_CLEAR below).
  setTimeout(() => {
    sendToPlayer(player.id, {
      type: 'arrest_notice',
      charge, stars, sentence: mins, confiscated, fine, held: heldCredits,
    });
    sendToPlayer(player.id, { type: 'wanted_level', stars });
  }, 700);

  const message = teleport
    ? `<span class="clone-vat-message">The cuffs bite in and a knee folds you down — then the cold steel bench of Precinct 9's holding block. Pockets empty, a charge sheet taped to the bars. "${mins}," the desk sergeant says, not looking up. Anything the law calls contraband has been logged to evidence; you won't be seeing that again.</span>`
    : `<span class="clone-vat-message">You come to on a steel bench in Precinct 9's holding block — wrists zip-tied, pockets empty, a charge sheet taped to the bars. The desk sergeant doesn't look up: "${mins}. Sit tight." Anything the law calls contraband has been logged to evidence; you won't be seeing that again.</span>`;

  if (teleport) {
    // No death occurred, so nothing has moved them or cleared their heat — do both.
    const bc = getBroadcast();
    await dispatchAction({ type: 'TELEPORT', actor: player, params: { zone_id: CELL_ZONE }, context: { broadcast: bc } });
    const zone = getZone(CELL_ZONE);
    if (zone) sendToPlayer(player.id, { type: 'move', message: await describeZone(zone, player), zone: CELL_ZONE, minimap: getMinimapData(CELL_ZONE, 8, player) });
    try { await dispatchAction({ type: 'WANTED_CLEAR', actor: player }); } catch { /* surveillance not loaded */ }
    sendToPlayer(player.id, { type: 'output', message });
  }
  return { booked: true, zone: CELL_ZONE, message };
}

// ── Jailing (the respawn hook) ───────────────────────────────────────────────
async function onRespawnZone(player, killer) {
  // A lawless zone (the Reach, the wastes, the slags) is a haven — no precinct hauls
  // you off for going down here, however wanted you are elsewhere. The cops don't come
  // to a no-cop zone to book a corpse; you clone-vat back like any clean death.
  if (getZone(player.current_zone)?.flags?.lawless) return undefined;
  const r = await bookIntoCell(player, { teleport: false });
  if (!r.booked) return undefined;   // clean death → normal clone-vat respawn
  return { zone: r.zone, message: r.message };
}

// ── Conceal: hide contraband from a search ────────────────────────────────────
// Proactive `conceal <item>` stashes a small contraband item (Deception check →
// the scanner rolls against it later). Reactive: on a live arrest, any *open*
// palmable contraband triggers a scan-sweep minigame — palm what you can before
// the scanner passes; a fumbled palm is caught (contraband-possession charge +
// heat). The arrest can't finish until the palm resolves, so ARREST arms it and
// books on reply. Both paths mark custom_data.concealed, which confiscate() honors.
const GLYPH = (tags) => tags?.weapon ? '▮' : tags?.hack_device ? '◈' : tags?.drug ? '☣' : '✦';

// Open (not-yet-concealed) palmable contraband the player is carrying.
async function openPalmableContraband(playerId) {
  const rows = await resolveInventoryItem(playerId, { topLevel: false, all: true }).catch(() => []);
  const out = [];
  for (const r of rows) {
    const tags = r.tags || {};
    if ((r.custom_data || {}).concealed) continue;   // already hidden
    if (!isPalmable(tags, r.weight)) continue;
    out.push({ invId: r.inv_id, name: r.name, glyph: GLYPH(tags) });
  }
  return out;
}

// Merge a `concealed` marker into an inventory row's custom_data.
async function markConcealed(invId, data) {
  await query(
    `UPDATE player_inventory
        SET custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('concealed', $2::jsonb)
      WHERE id = $1`,
    [invId, JSON.stringify(data)]
  );
}

// conceal <item> — proactively palm a small contraband item out of sight. A later
// search rolls Deception against it; a good stash beats the scanner.
async function cmdConceal(args, raw, player) {
  const hint = args.join(' ').trim();
  const rows = await resolveInventoryItem(player, { name: hint || undefined, topLevel: false, all: true });
  const cand = rows.find(r => isPalmable(r.tags, r.weight) && !((r.custom_data || {}).concealed));
  if (!cand) {
    return { type: 'error', message: hint
      ? `You can't palm a "${hint}" — it's not small contraband, or it's already tucked away.`
      : "You've nothing small and illicit to conceal." };
  }
  const chk = await skillCheck(player, 'deception', CONCEAL_DIFFICULTY);
  await awardSkillUse(player.id, 'deception', chk.margin);
  await markConcealed(cand.inv_id, { quality: Math.max(1, 3 + chk.margin), palmed: false });
  const how = chk.success
    ? 'It vanishes into a fold of clothing — you barely feel it there.'
    : "It's hidden, but not well — a thorough pat-down would turn it up.";
  return { type: 'output', message: `You slip the ${cand.name} out of sight. ${how}` };
}

// ── Live palm minigame handshake ─────────────────────────────────────────────
const pendingConceal = new Map();   // playerId -> { nonce, items:Set(invId), maxPalm, timer }

function clearConceal(playerId) {
  const p = pendingConceal.get(playerId);
  if (p?.timer) clearTimeout(p.timer);
  pendingConceal.delete(playerId);
}

// Arm the scan-sweep for a live arrest; book once the client replies (or times out).
async function armConceal(player, open) {
  const dex = await effectiveSkill(player, 'deception');
  const cool = Number(player.stat_cool) || 0;
  const scanMs = Math.round(2500 + 350 * dex + 120 * cool);          // steadier hands ⇒ a slower sweep
  const maxPalm = Math.max(1, Math.min(open.length, 1 + Math.floor(dex / 3)));
  const nonce = randomUUID().slice(0, 8);
  const timer = setTimeout(() => finishArrest(player.id).catch(e => console.error('[jail] conceal timeout:', e.message)), CONCEAL_TIMEOUT_MS);
  pendingConceal.set(player.id, { nonce, items: new Set(open.map(o => o.invId)), maxPalm, timer });
  sendToPlayer(player.id, {
    type: 'conceal_search', nonce, scanMs, maxPalm,
    items: open.map(o => ({ id: o.invId, name: o.name, glyph: o.glyph })),
  });
}

// concealresolve <nonce> <palmedIds csv> <botchedIds csv> — silent; the scan-sweep fires it.
async function cmdConcealResolve(args, raw, player) {
  const pend = pendingConceal.get(player.id);
  if (!pend || args[0] !== pend.nonce) return { type: 'noop' };   // stale / not armed
  const inSet = (csv) => (csv || '').split(',').filter(Boolean).filter(id => pend.items.has(id));
  const palmed = inSet(args[1]).slice(0, pend.maxPalm);           // server caps how many you can hold
  const botched = inSet(args[2]);
  for (const invId of palmed) await markConcealed(invId, { palmed: true, quality: 6 });
  if (botched.length) {
    // Caught mid-palm — a fresh contraband-possession charge (stars + heat, forced witness).
    await dispatchAction({ type: 'CHARGE_CRIME', actor: player, params: { key: 'contraband_possession' } }).catch(() => {});
    sendToPlayer(player.id, { type: 'system', message: `<span class="text-red">A hand clamps your wrist mid-reach — "What've you got there?" It goes on the sheet.</span>` });
  }
  clearConceal(player.id);
  await finishArrest(player.id);
  return { type: 'noop' };
}

// Complete booking after the palm resolves (or on timeout). Palmed items are
// already flagged concealed, so confiscate() leaves them on the player.
async function finishArrest(playerId) {
  clearConceal(playerId);
  const player = getLivePlayer(playerId);
  if (!player) return;
  await bookIntoCell(player, { teleport: true });
}

on('player.logout', ({ id }) => clearConceal(id));

// Cross-plugin seam: the surveillance apprehend engine books a *live* suspect (no
// death) once they submit to a ≤3.5★ arrest. If they're carrying open palmable
// contraband, the scan-sweep palm runs first; booking follows the client reply.
registerAction({
  type: 'ARREST',
  handler: async ({ actor }) => {
    if (!actor?.id) return { type: 'arrest', booked: false };
    const open = await openPalmableContraband(actor.id);
    if (open.length) { await armConceal(actor, open); return { type: 'arrest', pending: true }; }
    const r = await bookIntoCell(actor, { teleport: true });
    return { type: 'arrest', booked: r.booked };
  },
});

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

    // Return the cash the desk was holding, minus the booking fine. A fine larger
    // than what you were carrying leaves you owing (un-clamped, debt allowed).
    const refund = (rec.held_credits || 0) - (rec.fine || 0);
    const balRes = refund !== 0
      ? await query('UPDATE players SET credits = credits + $1 WHERE id = $2 RETURNING credits', [refund, playerId]).catch(() => null)
      : null;

    const player = getLivePlayer(playerId);
    if (player) {
      if (balRes?.rows[0]) player.credits = balRes.rows[0].credits;
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
      if (zone) sendToPlayer(playerId, { type: 'move', message: await describeZone(zone, player), zone: rec.release_zone, minimap: getMinimapData(rec.release_zone, 8, player) });
      sendToPlayer(playerId, { type: 'output', message: `<span class="msg-system">${officerName} slides a plastic tub across the counter — your things, minus anything the law keeps. "Stay out of trouble."</span>` });
      if (rec.held_credits || rec.fine) {
        const ledger = rec.fine > 0
          ? `₵${rec.held_credits} seized, ₵${rec.fine} kept for your fine — ₵${Math.max(0, refund)} back${refund < 0 ? ` and you're ₵${-refund} in the hole` : ''}.`
          : `₵${rec.held_credits} returned in full.`;
        sendToPlayer(playerId, { type: 'output', message: `<span class="msg-system">A receipt is stapled to the tub: ${ledger}</span>` });
      }
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

// ── Fail-safe: re-lock the cell behind an admin ──────────────────────────────
// An admin can pop the holding-cell hololock (to fish someone out, or just testing).
// If they wander off and forget to re-lock it, the block sits wide open and any prisoner
// strolls free. So: track an admin from the moment they step INTO the cell, and the moment
// they step back OUT, slam the hololock shut + closed behind them. Only admins trip this —
// prisoners/guards run their own (escape / walk-out) paths, untouched.
const ADMIN_ROLES = new Set(['admin', 'dev', 'builder', 'designer']);
const CELL_DOOR = 'door_precinct_cell';
const adminInCell = new Set();

async function secureCellDoor() {
  const door = getDoorById(CELL_DOOR) || getZoneDoors(CELL_ZONE)[0];
  if (!door) return false;
  if (door.lock_state === 'locked' && !door.is_open) return false;   // already shut + locked
  door.lock_state = 'locked'; door.is_open = 0;
  setDoorCache(door.id, door);
  emit('door.toggled', { zoneId: door.zone_id, targetZoneId: door.target_zone });
  return true;
}

on('zone.entered', async ({ actor, zone }) => {
  if (!actor?.id || !ADMIN_ROLES.has(actor.role)) return;
  if (zone === CELL_ZONE) { adminInCell.add(actor.id); return; }
  if (!adminInCell.delete(actor.id)) return;   // this admin wasn't in the cell
  if (await secureCellDoor().catch(() => false)) {
    sendToPlayer(actor.id, { type: 'output', message: '<span class="text-dim">The cell hololock re-engages behind you.</span>' });
    getBroadcast()?.(CELL_ZONE, { type: 'zone_event', message: 'The cell hololock slams shut with a heavy magnetic clunk.', refresh: true }, actor.id);
  }
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
    // Each star == MINUTE of real time × the world-clock scale (matching the
    // scaled-up sentence), so divide the remaining real time back down by scale.
    const remaining = Math.max(0, Math.min(r.stars, Math.ceil(gameMsToReal(new Date(r.release_at).getTime() - now) / MINUTE)));
    sendToPlayer(r.player_id, { type: 'wanted_level', stars: remaining });
  }
});

// ── Evidence purge ───────────────────────────────────────────────────────────
async function purgeEvidence() {
  await query(`DELETE FROM police_evidence WHERE created_at < NOW() - $1::interval`, [`${gameMsToReal(PURGE_MS)} milliseconds`]).catch(() => {});
}
schedule('1h', () => purgeEvidence());

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

export const commands = {
  conceal: cmdConceal,
  concealresolve: cmdConcealResolve,
};

export const hooks = { 'player.respawnZone': onRespawnZone };

// Exposed for the regression harness.
export const _test = { confiscate, restoreHeld, release, escape, onRespawnZone, isContraband, onDutyOfficerId, OFFICERS, CELL_ZONE, RELEASE_ZONE, BUNK_ZONE };

console.log('[jail] Plugin loaded.');
