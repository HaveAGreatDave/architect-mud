/**
 * Augments — installable cybernetics; the machine-path mirror of mutations.
 *
 * Where mutations are radiation-random, permanent, and free, augments are
 * chosen, paid, slot-limited, and removable. Install applies stat_modifiers the
 * same way grantMutation does, nudges the player down the Machine path, and
 * costs standing with the human-path orders (the Long Watch, the Wildblood).
 *
 * The three engine seams are now wired:
 *   1. Soak — a registered armor contributor merges subdermal-weave soak into
 *      player.soak on every recomputeArmor (armor under the skin).
 *   2. Chrome-can't-mutate — this plugin maintains player.chromed; the engine's
 *      checkMutationTrigger bails when it's set, and the FIRST install burns off
 *      any mutations already carried (the flesh→machine conversion).
 *   3. Cortical-backup death loop — the Ascendant "death is a billing problem"
 *      economy: prepaid restores bought at Halcyon, snapshots saved at the Vats,
 *      a non-jailed death rolled back to the last snapshot.
 * See docs/proposals/ascendant-stronghold.md and docs/systems-corps.md siblings.
 */
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { world, getLivePlayer } from '../../server/engine/world.js';
import { getFlag } from '../../server/engine/flags.js';
import { getPlayerIdeologyRep, REP_TIERS } from '../../server/engine/ideologies.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { on } from '../../server/engine/events.js';
import { registerArmorContributor, addSoakToSlot, recomputeEquipped } from '../../server/engine/commands/inventory.js';
import { burnAllMutations } from '../../server/engine/mutations.js';

const ASCENDANTS = 'ideology_ascendants';
// The orders that hold an Ascendant install against you. The first two are the human-path orders.
// The Null are here for a different reason and it is worth the sentence: their objection is to
// RELIANCE, not to hardware. They wear steel arms themselves, but theirs are cable and spring with a
// servicing card tied to the wrist, and nothing in one of those is an `augments` row — so a Null
// limb never reaches this code path and only city chrome ever costs you standing with them.
const OPPOSED = ['ideology_long_watch', 'ideology_wildblood', 'ideology_null'];

// Slot capacity per body region — caps force real builds over stacking.
const SLOT_CAPS = { neural: 2, eyes: 1, torso: 2, arms: 1, legs: 1 };

const OPPOSED_REP_HIT = -25; // standing lost with each human-path order per install
const PATH_GAIN = 8;         // machine-path affinity gained per install

const CORTICAL = 'aug_cortical_backup';  // the augment that unlocks the backup loop
const RESTORE_PRICE = 2500;              // ₵ per prepaid restore, bought at Halcyon

const TIER_RANK = Object.fromEntries(REP_TIERS.map((t, i) => [t.id, i]));

let AUGMENT_CACHE = null;

async function loadAugments() {
  const { rows } = await query('SELECT * FROM augments');
  const cache = {};
  for (const a of rows) cache[a.id] = a;
  AUGMENT_CACHE = cache;
  return cache;
}
async function catalog() {
  if (!AUGMENT_CACHE) await loadAugments();
  return AUGMENT_CACHE;
}

async function installedRows(playerId) {
  const { rows } = await query('SELECT augment_id, slot FROM player_augments WHERE player_id=$1', [playerId]);
  return rows;
}

function findAugment(cache, needle) {
  const q = needle.toLowerCase();
  const all = Object.values(cache);
  return all.find(a => a.id.toLowerCase() === q)
      || all.find(a => a.name.toLowerCase() === q)
      || all.find(a => a.name.toLowerCase().includes(q));
}

async function ascendantRank(playerId) {
  const reps = await getPlayerIdeologyRep(playerId);
  const row = reps.find(r => r.id === ASCENDANTS);
  return TIER_RANK[row?.tier || 'unknown'] ?? 0;
}

function statLine(mods) {
  const e = Object.entries(mods || {});
  if (!e.length) return '';
  return e.map(([k, v]) => `${k.replace('stat_', '')}${v > 0 ? '+' : ''}${v}`).join(', ');
}

// stat_modifiers applied additively to the players row + memory, mirroring
// grantMutation. `sign` is +1 on install, -1 on remove.
async function applyStatMods(player, mods, sign) {
  const entries = Object.entries(mods || {});
  if (!entries.length) return;
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [stat, delta] of entries) {
    sets.push(`${stat} = ${stat} + $${i++}`);
    vals.push(delta * sign);
  }
  vals.push(player.id);
  await query(`UPDATE players SET ${sets.join(', ')} WHERE id = $${i}`, vals);
  for (const [stat, delta] of entries) {
    if (player[stat] !== undefined) player[stat] += delta * sign;
  }
}

// --- Seam 1 + 2: augment-derived player state ------------------------------
// Registered armor contributor. On every recomputeArmor (login, equip/unequip)
// this reads the player's installed augments and (a) layers subdermal-weave soak
// into the per-slot map, (b) sets player.chromed for the mutation-block guard.
// Async is fine here — recomputeArmor runs on deliberate actions, never a
// per-swing hot path; combat reads the finished player.soak from memory.
// An EMP pulse knocks chrome out for a few minutes. The window is a plain
// timestamp on the live player (set by the weather plugin's empPulse handler,
// which forces a recompute at both ends) — transient state, memory only, never
// the DB. `chromed` stays set: your body is still full of hardware, it's just
// not doing anything for you right now.
function chromeDown(player) {
  return !!player?._augFriedUntil && Date.now() < player._augFriedUntil;
}

async function contributeAugmentState(player, bySlot) {
  const cache = await catalog();
  const mine = await installedRows(player.id);
  player.chromed = mine.length > 0 ? 1 : 0;
  if (chromeDown(player)) return;
  for (const r of mine) {
    const a = cache[r.augment_id];
    if (!a || !a.soak || typeof a.soak !== 'object') continue;
    // soak jsonb shape mirrors armor: { <armor-slot>: { <type>: value } }.
    for (const [slot, sm] of Object.entries(a.soak)) addSoakToSlot(bySlot, slot, sm);
  }
}
registerArmorContributor(contributeAugmentState);

// Refresh a live player's augment-derived state after an install/remove — one
// recompute rebuilds soak, insulation, and player.chromed together.
async function refreshAugmentState(player) {
  await recomputeEquipped(player);
}

// Install/remove is clinic work — you can't chrome up in the street. The clinic
// zone opts in with flags.augment_clinic.
function atClinic(player) {
  const zone = world.zones.get(player.current_zone);
  return !!zone?.flags?.augment_clinic;
}

// --- list (works anywhere — it's your own body) ----------------------------
async function listAugments(player) {
  const cache = await catalog();
  const mine = await installedRows(player.id);
  let msg = '<span class="skills-header">YOUR AUGMENTS</span>\n\n';
  if (!mine.length) {
    msg += 'Baseline. No chrome installed.\n\n';
  } else {
    for (const r of mine) {
      const a = cache[r.augment_id];
      if (!a) continue;
      msg += `<span class="zone-name">${a.name}</span> <span style="opacity:.7">[${a.slot}]</span>\n${a.description}\n`;
      const s = statLine(a.stat_modifiers);
      if (s) msg += `  Stats: ${s}\n`;
      const soakTypes = Object.values(a.soak || {}).flatMap(m => Object.keys(m || {}));
      if (soakTypes.length) msg += `  Soak: ${[...new Set(soakTypes)].join(', ')} (under the skin)\n`;
      msg += '\n';
    }
  }
  const used = {};
  for (const r of mine) used[r.slot] = (used[r.slot] || 0) + 1;
  msg += '<span class="skills-header">SLOTS</span>\n';
  for (const [slot, cap] of Object.entries(SLOT_CAPS)) {
    msg += `  ${slot.padEnd(7)} ${used[slot] || 0}/${cap}\n`;
  }
  return { type: 'augments', message: msg };
}

// --- install ---------------------------------------------------------------
async function installAugment(name, player) {
  if (!name) return { type: 'error', message: 'Install what? Try: augment install <name>' };
  if (!atClinic(player)) {
    return { type: 'error', message: "You can't install chrome out here — this is clinic work. Find a chrome-doctor's theatre." };
  }
  const cache = await catalog();
  const aug = findAugment(cache, name);
  if (!aug) return { type: 'error', message: `No such augment: "${name}".` };

  const mine = await installedRows(player.id);
  if (mine.some(r => r.augment_id === aug.id)) {
    return { type: 'error', message: `You already have ${aug.name} installed.` };
  }
  const cap = SLOT_CAPS[aug.slot] ?? 1;
  const usedInSlot = mine.filter(r => r.slot === aug.slot).length;
  if (usedInSlot >= cap) {
    return { type: 'error', message: `No free ${aug.slot} slot (${usedInSlot}/${cap}). Pull something first.` };
  }
  const rank = await ascendantRank(player.id);
  if (rank < (TIER_RANK[aug.rep_gate] ?? 0)) {
    const gate = REP_TIERS.find(t => t.id === aug.rep_gate);
    return { type: 'error', message: `${aug.name} is reserved for those the Ascendants trust (${gate?.label || aug.rep_gate}). Raise your standing first.` };
  }
  const cost = aug.cost || 0;
  if ((player.credits || 0) < cost) {
    return { type: 'error', message: `${aug.name} costs ₵${cost}. You can't afford it.` };
  }

  // --- commit ---
  const wasFirst = mine.length === 0;
  if (cost) {
    await query('UPDATE players SET credits = credits - $1 WHERE id=$2', [cost, player.id]);
    player.credits -= cost;
  }
  await applyStatMods(player, aug.stat_modifiers, +1);
  await query(
    'INSERT INTO player_augments (player_id, augment_id, slot) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [player.id, aug.id, aug.slot]
  );

  // Seam 2 — the first chrome burns off the flesh. A deliberate, warned choice at
  // the terminal (never a random rad-mugging), delivered as the doctor's line.
  let burnLine = '';
  if (wasFirst) {
    const n = await burnAllMutations(player);
    if (n) burnLine = `\n<span style="opacity:.8">Kesh's needle finds the old flesh-code and overwrites it. ${n} mutation${n > 1 ? 's' : ''} slough away — chrome and mutation can't share a body.</span>`;
  }

  // Machine path + the teeth. Fired through the registered ideology Actions so
  // this plugin never reaches into ideology state directly (interaction rule).
  await dispatchAction({ type: 'ADJUST_PATH', actor: player, params: { path: 'machine', delta: PATH_GAIN } });
  for (const opp of OPPOSED) {
    await dispatchAction({ type: 'ADJUST_REPUTATION', actor: player, params: { ideology_id: opp, delta: OPPOSED_REP_HIT, reason: 'augment install' } });
  }

  // Refresh derived state (soak, chromed) now that the roster changed.
  await refreshAugmentState(player);

  const s = statLine(aug.stat_modifiers);
  const soakTypes = Object.values(aug.soak || {}).flatMap(m => Object.keys(m || {}));
  const soakLine = soakTypes.length ? ` Plating settles under your skin — ${[...new Set(soakTypes)].join('/')} soak.` : '';
  const specialLine = aug.id === CORTICAL
    ? '\n<span style="opacity:.7">Your consciousness now has a save file. Buy restores at Halcyon; snapshot yourself at the Vats.</span>'
    : (!s && !soakTypes.length && aug.special) ? '\n<span style="opacity:.7">(Its effect is passive.)</span>' : '';
  return { type: 'augments', message: `<span class="zone-name">${aug.name}</span> installed.${s ? ` ${s}.` : ''}${soakLine}${burnLine}${specialLine}\nThe unwired will notice.` };
}

// --- remove ----------------------------------------------------------------
async function removeAugment(name, player) {
  if (!name) return { type: 'error', message: 'Remove what? Try: augment remove <name>' };
  if (!atClinic(player)) {
    return { type: 'error', message: 'Pulling chrome is clinic work too. Not here.' };
  }
  const cache = await catalog();
  const aug = findAugment(cache, name);
  if (!aug) return { type: 'error', message: `No such augment: "${name}".` };
  const mine = await installedRows(player.id);
  if (!mine.some(r => r.augment_id === aug.id)) {
    return { type: 'error', message: `You don't have ${aug.name} installed.` };
  }
  await applyStatMods(player, aug.stat_modifiers, -1);
  await query('DELETE FROM player_augments WHERE player_id=$1 AND augment_id=$2', [player.id, aug.id]);
  // Reverse the machine-path nudge; the standing you burned with the human orders
  // stays burned (pulling chrome doesn't un-happen the offense).
  await dispatchAction({ type: 'ADJUST_PATH', actor: player, params: { path: 'machine', delta: -PATH_GAIN } });
  await refreshAugmentState(player);
  return { type: 'augments', message: `<span class="zone-name">${aug.name}</span> removed.` };
}

async function cmdAugment(args, raw, player) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'install') return installAugment(args.slice(1).join(' '), player);
  if (sub === 'remove')  return removeAugment(args.slice(1).join(' '), player);
  return listAugments(player);
}

// --- Seam 3: the cortical-backup loop --------------------------------------

async function hasCortical(playerId) {
  const { rows } = await query('SELECT 1 FROM player_augments WHERE player_id=$1 AND augment_id=$2', [playerId, CORTICAL]);
  return rows.length > 0;
}
async function getBackup(playerId) {
  const { rows } = await query('SELECT snapshot, restores_remaining, saved_at FROM player_backups WHERE player_id=$1', [playerId]);
  return rows[0] || null;
}

// `backup` — snapshot yourself at the Vats Registry. Captures the perishable
// state a restore rolls back to: inventory (with equip/slot/container/condition)
// and credits. Requires the Cortical Backup augment.
async function cmdBackup(args, raw, player) {
  const zone = world.zones.get(player.current_zone);
  if (!zone?.flags?.ascendant_registry) {
    return { type: 'error', message: 'You can only commit a backup at the Vats Registry.' };
  }
  if (!(await hasCortical(player.id))) {
    return { type: 'error', message: 'The Registry construct regards you flatly. "No cortical backup on file. There is nothing of you to save." Install the Cortical Backup augment first.' };
  }
  const { rows } = await query(
    'SELECT item_id, quantity, condition, is_equipped, slot, custom_data, container_id, id FROM player_inventory WHERE player_id=$1',
    [player.id]
  );
  const snapshot = {
    credits: player.credits || 0,
    inventory: rows.map(r => ({
      old_id: r.id, item_id: r.item_id, quantity: r.quantity, condition: r.condition,
      is_equipped: r.is_equipped, slot: r.slot, custom_data: r.custom_data || {}, container_id: r.container_id,
    })),
  };
  const existing = await getBackup(player.id);
  const restores = existing?.restores_remaining || 0;
  await query(
    `INSERT INTO player_backups (player_id, snapshot, restores_remaining, saved_at)
       VALUES ($1, $2, $3, EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (player_id) DO UPDATE SET snapshot = EXCLUDED.snapshot, saved_at = EXCLUDED.saved_at`,
    [player.id, JSON.stringify(snapshot), restores]
  );
  const paid = restores > 0
    ? `\n<span style="opacity:.8">Restores on account: ${restores}.</span>`
    : `\n<span class="outcast-warning">No restores on account. A backup with nothing to spend it on is just a photograph. Buy a policy at Halcyon.</span>`;
  return { type: 'output', message: `The tanks hum. For a moment you are two places at once, and then only here again — a copy of you laid down in cold storage.${paid}` };
}

// `assurance` — the secret Halcyon front. Buy prepaid restores (eligibility: you
// own the Cortical Backup augment). The transaction is itself a reveal
// breadcrumb — Halcyon billing IS the Ascendant resurrection desk. (The `policy`
// verb is already the aircraft-insurance desk; this is the cortical desk.)
async function cmdAssurance(args, raw, player) {
  const zone = world.zones.get(player.current_zone);
  if (!zone?.flags?.assurance_policy) {
    return { type: 'error', message: 'There is no assurance desk here.' };
  }
  const backup = await getBackup(player.id);
  const restores = backup?.restores_remaining || 0;
  const sub = (args[0] || '').toLowerCase();

  if (sub !== 'buy') {
    return { type: 'output', message:
      `<span class="skills-header">HALCYON ASSURANCE — CORTICAL POLICY</span>\n\n` +
      `"Death, sir, is a billing problem — and your account can be paid up."\n\n` +
      `Prepaid restores on file: <b>${restores}</b>\n` +
      `Price per restore: ₵${RESTORE_PRICE}\n\n` +
      `<span style="opacity:.7">assurance buy [n] — purchase restores. Requires a cortical backup on file.</span>` };
  }

  if (!(await hasCortical(player.id))) {
    return { type: 'error', message: 'The adjuster checks a screen and shakes their head, almost kindly. "We can only insure what can be restored. You have no cortical backup. Speak to the Ascendants about that first." — a slip they don\'t seem to notice making.' };
  }
  const n = Math.max(1, Math.min(20, parseInt(args[1], 10) || 1));
  const cost = n * RESTORE_PRICE;
  if ((player.credits || 0) < cost) {
    return { type: 'error', message: `${n} restore${n > 1 ? 's' : ''} costs ₵${cost}. Your account doesn't cover it.` };
  }
  await query('UPDATE players SET credits = credits - $1 WHERE id=$2', [cost, player.id]);
  player.credits -= cost;
  await query(
    `INSERT INTO player_backups (player_id, restores_remaining, saved_at)
       VALUES ($1, $2, EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (player_id) DO UPDATE SET restores_remaining = player_backups.restores_remaining + $2`,
    [player.id, n]
  );
  const after = (backup?.restores_remaining || 0) + n;
  return { type: 'output', message: `The adjuster's stylus moves. ₵${cost} clears. "You're covered for ${n} more, then. ${after} on account." Behind them, a screen shows a calm closed eye — the Halcyon seal, or something older wearing it.\n<span class="player-update-credits">₵${player.credits}</span>` };
}

// player.respawnZone hook: a non-jailed death with a paid restore rolls the
// player back to their last Vats snapshot instead of the clone vat. Jail wins —
// a wanted death goes to Holding even for the backed-up ("jail still bites"), so
// this yields (returns undefined) whenever the player would be booked.
async function onRespawnZone(player, killer) {
  // Yield to jail: mirror jail's own claim test (wanted peak >= 1 star).
  let wanted = parseFloat(await getFlag('player', 'wanted', player) || '0') || 0;
  try {
    const r = await dispatchAction({ type: 'WANTED_PEAK', actor: player });
    if (typeof r?.peak === 'number') wanted = Math.max(wanted, r.peak);
  } catch { /* surveillance not loaded — fall back to the flag */ }
  if (Math.floor(wanted) >= 1) return undefined;

  const backup = await getBackup(player.id);
  if (!backup || !backup.snapshot || (backup.restores_remaining || 0) < 1) return undefined;

  // Find the respawn landing — the Vat Hall.
  const vatHall = [...world.zones.values()].find(z => z.flags?.ascendant_vats);
  if (!vatHall) return undefined;

  // Consume a restore and roll inventory + credits back to the snapshot. Gear
  // gained since the save is destroyed (there's no lootable corpse on override).
  await query('UPDATE player_backups SET restores_remaining = restores_remaining - 1 WHERE player_id=$1', [player.id]);
  const snap = backup.snapshot;
  await query('UPDATE players SET credits = $1 WHERE id=$2', [snap.credits || 0, player.id]);
  player.credits = snap.credits || 0;

  // Rebuild inventory from the snapshot. Regenerate row ids and remap any
  // container_id references so nested containers survive the rewrite.
  await query('DELETE FROM player_inventory WHERE player_id=$1', [player.id]);
  const items = Array.isArray(snap.inventory) ? snap.inventory : [];
  const idMap = new Map();
  for (const it of items) idMap.set(it.old_id, randomUUID());
  for (const it of items) {
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, is_equipped, slot, custom_data, container_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [idMap.get(it.old_id), player.id, it.item_id, it.quantity ?? 1, it.condition ?? 1.0,
       it.is_equipped ?? 0, it.slot ?? null, JSON.stringify(it.custom_data || {}),
       it.container_id ? (idMap.get(it.container_id) || null) : null]
    );
  }
  await recomputeEquipped(player);   // restored gear drives soak/insulation again

  const left = Math.max(0, (backup.restores_remaining || 1) - 1);
  return {
    zone: vatHall.id,
    skipOutfit: true,   // the snapshot already re-hydrated the wardrobe
    message: `<span class="clone-vat-message">The Vats hold your policy. You surface in cold fog, whole, wearing the life you last saved — everything since gone like a dream you can't keep. A construct notes the withdrawal. ${left} restore${left === 1 ? '' : 's'} remaining.</span>`,
  };
}

// Derive player.chromed at login for the mutation-block guard (recomputeEquipped
// runs on connect and fires the contributor, so this is a belt-and-braces refresh
// for any path that loads a player without recomputing armor).
on('player.login', async ({ id }) => {
  const p = getLivePlayer(id);
  if (!p) return;
  const { rows } = await query('SELECT 1 FROM player_augments WHERE player_id=$1 LIMIT 1', [id]);
  p.chromed = rows.length ? 1 : 0;
});

export const commands = {
  augment: cmdAugment,
  augments: cmdAugment,
  backup: cmdBackup,
  assurance: cmdAssurance,
};

export const hooks = { 'player.respawnZone': onRespawnZone };

// Exposed for the regression harness.
export const _test = { loadAugments, findAugment, SLOT_CAPS, contributeAugmentState, onRespawnZone, hasCortical, getBackup, CORTICAL, RESTORE_PRICE };
