/**
 * Augments — installable cybernetics; the machine-path mirror of mutations.
 *
 * Where mutations are radiation-random, permanent, and free, augments are
 * chosen, paid, slot-limited, and removable. Install applies stat_modifiers the
 * same way grantMutation does, nudges the player down the Machine path, and
 * costs standing with the human-path orders (the Long Watch, the Wildblood).
 *
 * STEP-1 SCOPE (this file): the mechanic + catalog + install/remove/list, gated
 * to a clinic zone (flags.augment_clinic). The combat/death seams — subdermal
 * soak via recomputeArmor, the "chrome can't mutate" guard, and the cortical-
 * backup respawn — are step 2 (engine-change). Augments whose only effect is
 * soak/special are therefore authored but INERT until then; this plugin says so
 * rather than pretending they work. See docs/proposals/ascendant-stronghold.md.
 */
import { query } from '../../server/models/db.js';
import { world } from '../../server/engine/world.js';
import { getPlayerIdeologyRep, REP_TIERS } from '../../server/engine/ideologies.js';
import { dispatchAction } from '../../server/engine/actions.js';

const ASCENDANTS = 'ideology_ascendants';
const OPPOSED = ['ideology_long_watch', 'ideology_wildblood']; // the human-path orders

// Slot capacity per body region — caps force real builds over stacking.
const SLOT_CAPS = { neural: 2, eyes: 1, torso: 2, arms: 1, legs: 1 };

const OPPOSED_REP_HIT = -25; // standing lost with each human-path order per install
const PATH_GAIN = 8;         // machine-path affinity gained per install

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

// Install/remove is clinic work — you can't chrome up in the street. The clinic
// zone opts in with flags.augment_clinic (no zone carries it until the campus
// content ships; the mechanic is complete and inert until then).
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
  if (cost) {
    await query('UPDATE players SET credits = credits - $1 WHERE id=$2', [cost, player.id]);
    player.credits -= cost;
  }
  await applyStatMods(player, aug.stat_modifiers, +1);
  await query(
    'INSERT INTO player_augments (player_id, augment_id, slot) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [player.id, aug.id, aug.slot]
  );
  // Machine path + the teeth. Fired through the registered ideology Actions so
  // this plugin never reaches into ideology state directly (interaction rule).
  await dispatchAction({ type: 'ADJUST_PATH', actor: player, params: { path: 'machine', delta: PATH_GAIN } });
  for (const opp of OPPOSED) {
    await dispatchAction({ type: 'ADJUST_REPUTATION', actor: player, params: { ideology_id: opp, delta: OPPOSED_REP_HIT, reason: 'augment install' } });
  }

  const s = statLine(aug.stat_modifiers);
  const inert = (!s && (Object.keys(aug.soak || {}).length || aug.special))
    ? '\n<span style="opacity:.7">(Its full effect comes online with a later system.)</span>' : '';
  return { type: 'augments', message: `<span class="zone-name">${aug.name}</span> installed.${s ? ` ${s}.` : ''}${inert}\nThe unwired will notice.` };
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
  return { type: 'augments', message: `<span class="zone-name">${aug.name}</span> removed.` };
}

async function cmdAugment(args, raw, player) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'install') return installAugment(args.slice(1).join(' '), player);
  if (sub === 'remove')  return removeAugment(args.slice(1).join(' '), player);
  return listAugments(player);
}

export const commands = {
  augment: cmdAugment,
  augments: cmdAugment,
};

// Exposed for the regression harness.
export const _test = { loadAugments, findAugment, SLOT_CAPS };
