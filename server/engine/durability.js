/**
 * Durability — gear wearing out, and being put right again.
 *
 * `player_inventory.condition` (REAL, 0..1) has existed since the schema was
 * written and was read by nothing. Two plugins wrote it with their own
 * arithmetic and their own destroy-at-zero rules (the ATM hack deck, the fishing
 * rod). This is the one funnel: every read of what condition MEANS and every
 * write of what it BECOMES goes through here.
 *
 * ── The model ────────────────────────────────────────────────────────────────
 *
 * Condition is the item's HP bar. Wear events deal a fixed ABSOLUTE amount —
 * a landed swing costs the same wherever it lands. What differs per item is how
 * much of its life that costs, because CAPACITY is derived from `value`
 * (`durabilityOf`). Cheap gear frays fast; good gear lasts. Nothing is authored
 * per item, and every future item is correct the day it's added.
 *
 * ── The six rules this file exists to enforce ────────────────────────────────
 *
 *  1. Wear accrues on USE, never on the clock. Gear in your wardrobe is
 *     untouched forever. This is the single decision that stops the system
 *     becoming a chore, and it is why (unlike preservation, which this file is
 *     otherwise modelled on) there is no elapsed-time integration anywhere here.
 *  2. Bands, not a bleeding percentage. The player never sees 87%.
 *  3. Two-thirds of an item's life is mechanically free — Worn costs nothing
 *     but a scruffier examine line.
 *  4. Zero condition DESTROYS the item. It disintegrates and is gone — there is
 *     no broken-but-repairable state to fall back on.
 *  5. Failure is always predicted, and rule 4 is exactly why this one is
 *     load-bearing rather than polite. Destruction is permanent, so the Failing
 *     band and the fatigue warnings on examine are the ONLY thing standing
 *     between a player and losing something they cared about. Never let an item
 *     reach zero without the game having said so, repeatedly, first.
 *  6. One glance, not an audit. The band shows on examine and in `gear`.
 *
 * ── Read tier ────────────────────────────────────────────────────────────────
 *
 * Wear is applied on the combat hot path, so it CANNOT query. Accrual is
 * in-memory (`player._wearPending`, keyed by inventory row id) against condition
 * values already cached on the live player by `recomputeEquipped` /
 * `getEquippedWeapon`, and flushed in one coalesced multi-row UPDATE on a
 * cadence — the flushDirtyResources pattern. `wear()` is therefore SYNCHRONOUS
 * BY CONTRACT and must never learn to await.
 */
import { query } from '../models/db.js';
import { emit } from './events.js';
import { world } from './world.js';
import { sendToPlayer } from './messaging.js';
import { mutationNumber } from './mutations.js';

// ── What wears ───────────────────────────────────────────────────────────────
//
// Derived from what an item already IS — no `wearable` tag to author, forget, or
// drift. Consumables never wear (they're eaten), and neither does anything
// without a combat or carry role.
const BODY_SLOTS = new Set(['head', 'torso', 'hands', 'legs', 'feet']);
// `electronic` is here so an EMP-fried device is something a bench can be asked
// to look at at all — the repair path only considers things that wear.
const TOOL_TAGS = ['hack_device', 'fishing_rod', 'mining_tool', 'tool', 'cook_kit', 'flashlight', 'lockpick', 'electronic'];

export function wearableCategory(item) {
  const t = item?.tags || {};
  if (t.consumable || t.drug) return null;      // eaten, not worn out
  if (t.weapon) return 'weapon';
  if (t.armor_soak) return 'armor';
  if (BODY_SLOTS.has(t.slot) || t.slot === 'accessory') return 'apparel';
  if (TOOL_TAGS.some((tag) => t[tag])) return 'tool';
  return null;
}

export const wears = (item) => wearableCategory(item) !== null;

// If it wears, it repairs. `no_repair` is the opt-out for the handful of things
// that genuinely can't be fixed at a bench — sealed chrome, burned firmware.
//
// Opt-OUT deliberately, not opt-in: forgetting an opt-out makes something
// repairable that arguably shouldn't be (harmless); forgetting an opt-in ships
// an item that wears down and can never be fixed, which is indistinguishable
// from a bug and only surfaces weeks later. Default to the direction that fails
// harmlessly.
export function isRepairable(item) {
  return wears(item) && !item?.tags?.no_repair;
}

// ── Capacity ─────────────────────────────────────────────────────────────────
//
// How much wear this item can absorb before it's finished, as a multiplier on
// the base pool. Derived from `value` — which is authored for shop pricing, not
// durability, so it IS wrong sometimes. Two things keep that acceptable: only
// wearable categories consult it at all (a 400₵ cognac has no durability), and
// within weapons/armour/apparel/tools price tracks quality closely enough.
//
// Sub-linear (fourth root): a 1000₵ weapon lasts about three times as long as a
// 10₵ one, not a hundred times. Otherwise good gear never wears at all and the
// system quietly switches itself off for anyone who can afford it.
const BASE_DURABILITY = 40;      // wear points in a 10₵ item's whole life
const CATEGORY_TOUGHNESS = { weapon: 1.0, armor: 1.2, apparel: 0.8, tool: 1.0 };

// REINFORCEMENT — the thing an NPC bench can never sell you.
//
// A masterful repair by a PERSON doesn't just restore the item, it makes it
// tougher from here on: +20% capacity per reinforcement, three deep. This is the
// whole economic argument for player repairmen. Watts is reliable, always open,
// and expensive; a genuinely skilled player can hand you back something BETTER
// than it left the factory, and no amount of money at a counter buys that.
//
// Deliberately permanent and transferable — it rides `custom_data`, so a
// reinforced coat is worth more on the open market than a fresh one, and the
// player who did the work has their name on it (`repaired_by`).
export const REINFORCE_STEP = 0.2;
export const REINFORCE_MAX = 3;

// FATIGUE — the reason you can't just mend a thing forever.
//
// Every repair leaves the item a little more likely to simply GO. Not worse in
// the bands (a mended coat is as good as its condition says), but more brittle:
// each mend adds a small chance, per wear event, that it fails outright instead
// of degrading another notch. That's what stops a starter jacket riding with you
// for a year on 30₵ of duct tape, without ever making repair feel pointless.
//
// REINFORCEMENT RESOLVES IT. A masterful hand repair stamps a watermark at the
// current repair count, so everything before it stops counting — the item is
// both tougher (capacity) and no more likely to break than one fresh out of the
// box. That is the second half of why a real tradesman is worth finding: Watts
// can keep your coat alive, but only a good hand can make it *new* again.
const BREAK_CHANCE_PER_MEND = 0.015;   // per wear event, per unresolved mend
const BREAK_CHANCE_CAP = 0.12;

function customDataOf(row) {
  return typeof row?.custom_data === 'string'
    ? (() => { try { return JSON.parse(row.custom_data); } catch { return {}; } })()
    : (row?.custom_data || {});
}

/** Mends that reinforcement hasn't forgiven. */
export function fatigueOf(row) {
  const cd = customDataOf(row);
  return Math.max(0, (Number(cd.repairs) || 0) - (Number(cd.fatigue_base) || 0));
}

/**
 * Chance THIS wear event finishes the item off outright.
 *
 * Gated on the item already being Battered or worse, which keeps rule 5 intact:
 * a fatigued item in good condition never surprises you. By the time it can go,
 * the game has been telling you it's on the way out for a while.
 */
export function breakChanceOf(row) {
  const band = conditionBand(effectiveCondition(row));
  if (band.id === 'pristine' || band.id === 'worn' || band.id === 'broken') return 0;
  return Math.min(BREAK_CHANCE_CAP, fatigueOf(row) * BREAK_CHANCE_PER_MEND);
}

export function reinforcementOf(row) {
  const cd = typeof row?.custom_data === 'string'
    ? (() => { try { return JSON.parse(row.custom_data); } catch { return {}; } })()
    : (row?.custom_data || {});
  return Math.min(REINFORCE_MAX, Math.max(0, Number(cd.reinforced) || 0));
}

export function durabilityOf(item) {
  const cat = wearableCategory(item);
  if (!cat) return Infinity;
  const value = Math.max(1, Number(item?.value) || 1);
  const grade = Math.pow(value / 10, 0.25);
  const override = Number(item?.tags?.wear_rate);   // authored escape hatch, rarely needed
  const scale = override > 0 ? 1 / override : 1;
  const reinforced = 1 + reinforcementOf(item) * REINFORCE_STEP;
  return BASE_DURABILITY * Math.max(0.25, grade) * (CATEGORY_TOUGHNESS[cat] || 1) * scale * reinforced;
}

// ── Bands ────────────────────────────────────────────────────────────────────
//
// Bands, not a curve — the same reasoning condition.js uses for temperature: a
// player has to be able to feel a discrete state they can act on, not a drift
// they can't read. `penalty` is a multiplier on whatever the item does.
//
// Note the shape of the ladder: PRISTINE and WORN are both mechanically free.
// Two-thirds of an item's life costs you nothing at all, which is what makes
// this realism rather than a tax.
export const BANDS = [
  { id: 'broken',   min: 0.00, label: 'Broken',   penalty: 0.00, colour: '#e05555' },
  { id: 'failing',  min: 0.15, label: 'Failing',  penalty: 0.60, colour: '#e08a55' },
  { id: 'battered', min: 0.40, label: 'Battered', penalty: 0.85, colour: '#d4c44a' },
  { id: 'worn',     min: 0.70, label: 'Worn',     penalty: 1.00, colour: '#b8b8cc' },
  { id: 'pristine', min: 0.95, label: 'Pristine', penalty: 1.00, colour: '#4caf74' },
];

export function conditionBand(v) {
  const c = Math.max(0, Math.min(1, Number(v ?? 1)));
  for (let i = BANDS.length - 1; i >= 0; i--) if (c >= BANDS[i].min) return BANDS[i];
  return BANDS[0];
}

/** Multiplier this item's effect should be scaled by. 1 for anything unworn. */
export function conditionPenalty(row) {
  return conditionBand(effectiveCondition(row)).penalty;
}

export const isBroken = (row) => effectiveCondition(row) <= 0;

// ── Live value ───────────────────────────────────────────────────────────────

// The row's stored condition minus whatever wear is pending an unflushed write.
// Every reader uses this, so a player never gets a swing's grace from the fact
// that the DB hasn't caught up yet.
export function effectiveCondition(row, player = null) {
  const stored = Number(row?.condition ?? 1);
  const id = row?.inv_id || row?.id;
  const pending = player?._wearPending?.get(id) || row?._wearPending || 0;
  return Math.max(0, Math.min(1, stored - pending));
}

// ── Wear (the only accrual path) ─────────────────────────────────────────────

// What a single event costs, in wear points. Absolute: one landed swing is one
// landed swing whatever you're holding. Capacity is what differs.
export const WEAR_EVENTS = {
  swing: 1,          // a landed attack, on the weapon
  taken: 1,          // a hit absorbed, on the armour that absorbed it
  hard_use: 2,       // a tool used at the edge of what it's for
  mishap: 8,         // a rod snapping, a deck browning out
};

/**
 * Apply wear. SYNCHRONOUS BY CONTRACT — memory only; the durable write is
 * coalesced by flushWear. Returns the band if it CHANGED, else null, so callers
 * can message once per transition rather than once per swing (rule 2).
 */
export function wear(player, row, points, reason = null) {
  if (!player || !row) return null;
  const id = row.inv_id || row.id;
  if (!id) return null;
  const item = row.tags ? row : null;
  const capacity = durabilityOf(item || row);
  if (!Number.isFinite(capacity)) return null;   // not a wearable thing

  if (!player._wearPending) player._wearPending = new Map();
  const before = conditionBand(effectiveCondition(row, player));

  // Acidic sweat and the like: some bodies are simply harder on cloth than
  // others. A multiplier rather than a flat add, so it scales with how punishing
  // the event already was — a mutation makes wear worse, it doesn't invent it.
  const bodyFactor = 1 + mutationNumber(player, 'wear_acceleration');
  const amount = ((Number(points) || 0) / capacity) * bodyFactor;
  if (amount <= 0) return null;
  player._wearPending.set(id, (player._wearPending.get(id) || 0) + amount);

  // Fatigue: a much-mended thing doesn't degrade gracefully, it GOES. Rolled
  // after the wear so the chance is read at the condition this event produced,
  // and gated inside breakChanceOf on the item already being Battered or worse —
  // a fatigued item in good shape never surprises you (rule 5).
  if (Math.random() < breakChanceOf({ ...row, _wearPending: player._wearPending.get(id) })) {
    destroyNow(player, row, 'fatigue');
    return { ...conditionBand(0), fatigued: true };
  }

  const after = conditionBand(effectiveCondition(row, player));
  // Worn to nothing: the item disintegrates (rule 4). By this point the player
  // has been told it was Battered, then Failing, and — if it had been mended —
  // that the repairs were fighting each other. Nothing here is a surprise.
  if (after.id === 'broken') {
    destroyNow(player, row, 'worn out');
    return after;
  }
  if (after.id === before.id) return null;

  emit('item.condition.changed', { actor: player, invId: id, from: before.id, to: after.id, reason });
  if (after.id === 'broken') emit('item.broken', { actor: player, invId: id, reason });
  return after;
}

/**
 * Tell the player their gear changed band — ONCE per transition, which is why
 * every caller passes `wear()`'s return value straight in (it is null unless the
 * band actually moved). Lives here rather than in combat.js because the message
 * is about durability, not about being hit: acid rain uses the same three lines.
 */
export function announceWear(player, row, band) {
  if (!band) return;
  const name = row?.name || 'your gear';
  const line = band.fatigued
    // A fatigue break is a different beat from wearing down to nothing: the item
    // was carrying too many repairs and one of them finally let go.
    ? `<span class="msg-system">Something in your ${name} lets go — an old mend, finally giving. It comes apart in your hands and that's the end of it.</span>`
    : band.id === 'broken'
    ? `<span class="msg-system">Your ${name} gives out for the last time and falls apart. It's gone.</span>`
    : `<span class="msg-system">Your ${name} is looking <span style="color:${band.colour}">${band.label.toLowerCase()}</span>.</span>`;
  sendToPlayer(player.id, { type: 'output', message: line });
}

/** Repair. Async — a repair is a deliberate act, never on a hot path. */
export async function repairItem(row, restoreFraction, { quality = null, by = null, reinforce = false } = {}) {
  const id = row?.inv_id || row?.id;
  if (!id) return null;
  const before = Number(row.condition ?? 1);
  const after = Math.max(0, Math.min(1, before + Math.max(0, restoreFraction)));
  // Repair history is the point, not the bookkeeping: an item that has been put
  // back together twice should SAY so on examine. It's what makes a player keep
  // a jacket they should have replaced.
  const cd = typeof row.custom_data === 'string'
    ? (() => { try { return JSON.parse(row.custom_data); } catch { return {}; } })()
    : (row.custom_data || {});
  const repairs = (Number(cd.repairs) || 0) + 1;
  const patch = { repairs };
  if (quality) patch.repair_quality = quality;
  if (by) patch.repaired_by = by;
  // Only a person's masterful work reinforces. The caller decides whether it
  // earned one; this just holds the ceiling.
  if (reinforce) {
    patch.reinforced = Math.min(REINFORCE_MAX, (Number(cd.reinforced) || 0) + 1);
    // Reinforcement RESOLVES fatigue: the watermark forgives every mend up to
    // now, so the item is both tougher and no more likely to break than one
    // fresh out of the box. This is the second half of why a real tradesman is
    // worth finding — a bench can keep a thing alive, only a good hand can make
    // it new again.
    patch.fatigue_base = repairs;
  }

  await query(
    `UPDATE player_inventory
        SET condition = $2,
            custom_data = COALESCE(custom_data,'{}'::jsonb) || $3::jsonb
      WHERE id = $1`,
    [id, after, JSON.stringify(patch)]
  );
  row.condition = after;
  row.custom_data = { ...cd, ...patch };
  return { before, after, repairs, band: conditionBand(after) };
}

/** Destroy a row outright. */
export async function destroyItem(row) {
  const id = row?.inv_id || row?.id;
  if (!id) return;
  await query('DELETE FROM player_inventory WHERE id = $1', [id]);
}

/**
 * An item has reached zero and disintegrates.
 *
 * Called from `wear()`, which is synchronous by contract, so the delete is
 * fire-and-forget — but every IN-MEMORY consequence lands immediately, because a
 * destroyed weapon must stop hitting on this tick, not in a minute:
 *   • its pending wear is dropped (there is no row left to flush against)
 *   • the equipped/worn caches that combat reads are cleared for it
 *   • `inventory.changed` invalidates the equipped-weapon cache for everyone else
 */
function destroyNow(player, row, reason) {
  const id = row.inv_id || row.id;
  player._wearPending?.delete(id);
  if (row.slot) player._wornRows?.delete(row.slot);
  if (player._equippedWeapon?.row && (player._equippedWeapon.row.inv_id === id)) player._equippedWeapon = { row: null, at: Date.now() };
  if (player.soak && row.slot) delete player.soak[row.slot];
  emit('item.destroyed', { actor: player, invId: id, itemId: row.item_id, name: row.name, reason });
  destroyItem(row)
    .then(() => emit('inventory.changed', { actor: player }))
    .catch((err) => console.error(`[durability] destroy failed for ${id}: ${err.message}`));
}

// ── Flush ────────────────────────────────────────────────────────────────────

export async function flushWear(player) {
  const pending = player?._wearPending;
  if (!pending?.size) return;
  const entries = [...pending.entries()];
  pending.clear();     // cleared up-front: the deltas are now owned by this write
  const rows = [];
  const params = [];
  entries.forEach(([id, amount]) => {
    const b = params.length;
    rows.push(`($${b + 1}::text, $${b + 2}::real)`);
    params.push(id, amount);
  });
  try {
    // GREATEST(0, …) is the floor: condition can reach broken but never invert,
    // and the arithmetic happens in the database so two sessions wearing the
    // same row can't clobber each other with stale reads.
    await query(
      `UPDATE player_inventory AS pi
          SET condition = GREATEST(0, pi.condition - v.amount)
         FROM (VALUES ${rows.join(', ')}) AS v(id, amount)
        WHERE pi.id = v.id`,
      params
    );
  } catch (err) {
    // Put the deltas back so the next flush retries. A lost wear write is a free
    // swing; a throw inside a scheduled tick is everyone's problem.
    for (const [id, amount] of entries) pending.set(id, (pending.get(id) || 0) + amount);
    console.error(`[durability] flush failed for ${player.id}: ${err.message}`);
  }
}

export async function flushAllWear() {
  const dirty = [];
  for (const p of world.players.values()) if (p._wearPending?.size) dirty.push(p);
  await Promise.all(dirty.map((p) => flushWear(p)));
}

// ── Display ──────────────────────────────────────────────────────────────────

/** The examine line. Returns null for anything that doesn't wear (rule 6). */
export function conditionLine(row) {
  if (!wears(row)) return null;
  const band = conditionBand(effectiveCondition(row));
  const cd = typeof row.custom_data === 'string'
    ? (() => { try { return JSON.parse(row.custom_data); } catch { return {}; } })()
    : (row.custom_data || {});
  const repairs = Number(cd.repairs) || 0;
  // A pristine, never-mended thing has nothing to say — silence is the default
  // so the majority of items read exactly as they did before this existed.
  if (band.id === 'pristine' && !repairs) return null;

  const mend = repairs === 1 ? ', mended once'
    : repairs === 2 ? ', twice-mended'
    : repairs > 2 ? `, mended ${repairs} times` : '';
  const state = band.id === 'broken'
    ? "It's broken — it won't do its job until someone puts it right"
    : `It is <span style="color:${band.colour}">${band.label.toLowerCase()}</span>${mend}`;
  // Reinforcement is the reason to hunt down a good repairman, so it has to be
  // legible on the item itself — and it names who did the work, which is how a
  // player builds a reputation the game never has to track for them.
  const reinforced = reinforcementOf(row);
  const by = cd.repaired_by ? ` by ${cd.repaired_by}` : '';
  const extra = reinforced
    ? ` <span class="text-dim">Someone who knew what they were doing has been at it${by} — it is ${reinforced > 2 ? 'built like it means it' : reinforced > 1 ? 'noticeably tougher' : 'a little tougher'} than it has any right to be.</span>`
    : '';
  // Fatigue has to be READABLE or the break is a gotcha. This is the warning
  // that makes rule 5 hold: by the time an item can go, it has been telling you.
  const fatigue = fatigueOf(row);
  const brittle = fatigue >= 5 ? " You wouldn't trust it in a fight."
    : fatigue >= 3 ? ' The repairs are starting to fight each other.'
    : fatigue >= 1 && band.id !== 'pristine' ? ' The mends are holding, for now.' : '';
  return `<span class="text-dim">${state}.${brittle}</span>${extra}`;
}
