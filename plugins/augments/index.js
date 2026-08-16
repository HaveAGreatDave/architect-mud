/**
 * Augments — chrome as a machine you own, not a stat you bought.
 *
 * The machine-path mirror of mutations. Where mutations are radiation-random,
 * permanent and free, augments are chosen, paid, slot-limited and removable —
 * and, since the maintenance pass, they are also HARDWARE: they have a condition,
 * a calibration, a temperature, and a limit you can decide to exceed.
 *
 * This file is routing and seam registration. Everything else lives in a sibling:
 *
 *   state.js      the catalog, the hydrated roster, every derived number.
 *                 THE ONLY WRITER OF player_augments.
 *   install.js    item → body and back. Surgery, risk bands, repair.
 *   surgeon.js    who is holding the scalpel, and what they charge.
 *   tuning.js     calibration and the board that sets it.
 *   overclock.js  heat, strain, running past spec, and coming apart.
 *   death.js      why nobody farms chrome off corpses.
 *   backup.js     the Ascendant cortical-backup loop.
 *
 * THE ENGINE SEAMS, all four registered here:
 *   1. Stats — a registered stat contributor (condition.js), DERIVED. This system
 *      used to bake modifiers into players.stat_* on install; it does not any
 *      more, and it must never go back. See the rules at the top of state.js.
 *   2. Soak — a registered armour contributor layers subdermal plating into
 *      player.soak and maintains player.chromed.
 *   3. Strain — a registered strain contributor (strain.js) accrues heat on the
 *      combat hot path, synchronously and without a single query.
 *   4. Respawn — the cortical-backup hook, and the death subscriber that corrupts
 *      whatever the policy didn't cover.
 *
 * Chrome can't mutate: player.chromed blocks checkMutationTrigger, and the first
 * install burns off any mutations already carried. `chromed_ever` is what makes
 * that one-way — without it a death that corrupted every augment would silently
 * re-open the flesh path.
 */
import { query } from '../../server/models/db.js';
import { world, getLivePlayer } from '../../server/engine/world.js';
import { schedule } from '../../server/engine/scheduler.js';
import { getFlag } from '../../server/engine/flags.js';
import { on } from '../../server/engine/events.js';
import { registerArmorContributor, addSoakToSlot } from '../../server/engine/commands/inventory.js';
import { registerStatContributor } from '../../server/engine/condition.js';
import { registerStrainContributor } from '../../server/engine/strain.js';
import { conditionBand } from '../../server/engine/durability.js';
import {
  loadAugments, catalog, catalogSync, findAugment, hydrateAugments, flushAugments,
  rosterOf, getAugments, hasAugment, recordOf, augmentStatBonus, augScale, chromeDown,
  fidelityOf, registerAugmentDown, SLOT_CAPS, BOTCHED_CALIBRATION_CAP,
} from './state.js';
import { installAugment, removeAugment, repairAugment, quoteInstall, atClinic } from './install.js';
import { cmdCalibrate, cmdCalibrateResolve } from './tuning.js';
import { cmdOverclock, onStrain, heatOf, heatBand } from './overclock.js';
import { augmentTargets } from './nulltarget.js';
import { corruptOnDeath } from './death.js';
import { cmdBackup, cmdAssurance, onRespawnZone, hasCortical, getBackup, CORTICAL, RESTORE_PRICE, FIDELITY_MAX } from './backup.js';
import { captureRoster, reprintClone } from './reprint.js';
import { artifactsFor } from './artifacts.js';
import { cmdCharge, powerDown, powerLine, onEnterZone as onPowerZone, restamp } from './power.js';

// Warm the catalog at load. The armour contributor and the strain path both read
// it SYNCHRONOUSLY and cannot await one in — an empty cache there is not a crash
// but it is silently no chrome at all, which is worse.
loadAugments().catch(e => console.warn('[augments] catalog load failed:', e.message));

// --- Seam 1: derived stats -------------------------------------------------
registerStatContributor((player, stat) => augmentStatBonus(player, stat), 'augments');

// --- Seam 2: soak + player.chromed -----------------------------------------
// Sync now, where it used to await a query per recompute. `chromed` is the OR of
// "has chrome in them" and "has ever had chrome" — the second half is the flag,
// because burning your mutations off is a decision death must not undo.
function contributeAugmentState(player, bySlot) {
  const roster = rosterOf(player);
  player.chromed = (roster.size > 0 || player._chromedEver) ? 1 : 0;
  if (chromeDown(player) || powerDown(player)) return;
  const cache = catalogSync();
  for (const rec of roster.values()) {
    const a = cache[rec.augment_id];
    if (!a || !a.soak || typeof a.soak !== 'object') continue;
    const scale = augScale(rec, fidelityOf(player));
    if (scale <= 0) continue;   // dead or wrecked chrome plates nothing
    // soak jsonb shape mirrors armor: { <armor-slot>: { <type>: value } }.
    // Scaled, so a battered uncalibrated weave genuinely stops less. This will
    // look like a bug to whoever plays it first; it is the system working.
    for (const [slot, sm] of Object.entries(a.soak)) {
      const scaled = {};
      for (const [k, v] of Object.entries(sm || {})) scaled[k] = Number(v) * scale;
      addSoakToSlot(bySlot, slot, scaled);
    }
  }
}
registerArmorContributor(contributeAugmentState);

// --- Seam 3: strain on the combat hot path ---------------------------------
registerStrainContributor(onStrain, 'augments');

// --- Seam 3b: a flat cell takes everything offline at once -----------------
// Wired here rather than imported inside state.js, which would be a cycle.
registerAugmentDown(powerDown);

// --- Seam 4: death ---------------------------------------------------------
// ONE subscriber owns capture → corrupt → re-print, and that is not tidiness.
//
// ⚠ `emit` IS FIRE-AND-FORGET (server/engine/events.js) — it does not await
// subscribers and it does not order them. So the three steps cannot be three
// subscribers, and the re-print cannot live back in the respawn hook: that hook
// runs BEFORE this event, so corruption would land on top of a finished restore
// and delete the rows it had just written. Inside one handler the ordering is
// our own awaits, and no plugin load order can get between them.
//
// `custody` (not `claimed`) is the only skip. The cops take the body, so there
// is nothing left to wreck; the Ascendants take the pattern and leave the body,
// so corruption absolutely does run for them — the chrome in the old torso is
// destroyed for real and the wreckage lands on their corpse like anyone's. The
// vats then print NEW hardware from what we captured a moment ago, which is
// what stops a restore conjuring an augment the player had already sold.
on('player.death', async ({ player, corpseId, custody, override }) => {
  if (!player || custody) return;
  const pattern = captureRoster(player);   // LIVE rows, before corruption eats them
  try { await corruptOnDeath(player, corpseId); } catch (e) { console.warn('[augments] corruption failed', e.message); }
  if (!override?.__ascendantRestore) return;
  try { await reprintClone(player, pattern, corpseId); } catch (e) { console.warn('[augments] re-print failed', e.message); }
});

// --- the coalesced flush ---------------------------------------------------
// The ONLY scheduled work this plugin does, and it is a flush, not a tick: no
// simulation runs here. It writes the condition that heat burned on the combat
// path, for the players who actually burned any. Idle-gated by the scheduler.
// Deliberate acts (tuning, overclock, install, repair) never wait for this —
// they write through at the moment the player chooses them.
schedule('1m', async () => {
  for (const p of world.players.values()) {
    if (!p?._augmentsDirty?.size && !p?._augWearPending?.size) continue;
    await flushAugments(p).catch(() => {});
  }
});

// --- the campus tops you up without being asked ----------------------------
// One of the small ways membership reads as membership: sockets everywhere and
// nobody mentioning them. Cheap — a sync charge read and an early return.
on('zone.entered', ({ player, zoneId }) => {
  if (player) onPowerZone(player, zoneId || player.current_zone);
});

// --- login -----------------------------------------------------------------
on('player.login', async ({ id }) => {
  const p = getLivePlayer(id);
  if (!p) return;
  await hydrateAugments(p);
  p._chromedEver = (await getFlag('player', 'chromed_ever', p)) === '1';
  p.chromed = (rosterOf(p).size > 0 || p._chromedEver) ? 1 : 0;
  // Fidelity is read from RAM on a sync path, so it has to be here before any
  // stat is derived. No row (the overwhelming majority of players) is 100.
  p._copyFidelity = Number((await getBackup(p.id))?.copy_fidelity ?? FIDELITY_MAX);
});

// --- the verb --------------------------------------------------------------

function statLine(mods, scale = 1) {
  const e = Object.entries(mods || {});
  if (!e.length) return '';
  return e.map(([k, v]) => {
    const eff = Math.round(v * scale);
    return `${k.replace('stat_', '')}${eff > 0 ? '+' : ''}${eff}`;
  }).join(', ');
}

async function listAugments(player) {
  await catalog();
  let msg = '<span class="skills-header">YOUR AUGMENTS</span>\n\n';
  const mine = getAugments(player);
  const fid = fidelityOf(player);
  if (!mine.length) {
    msg += 'Baseline. No chrome installed.\n\n';
  } else {
    for (const { rec, aug } of mine) {
      const scale = augScale(rec, fidelityOf(player));
      const band = conditionBand(rec.condition);
      const heat = heatOf(player, rec.augment_id);
      const hb = heatBand(heat);
      const dead = Number(rec.condition ?? 1) <= 0;

      msg += `<span class="zone-name">${aug.name}</span> <span style="opacity:.7">[${rec.slot}]</span>`;
      if (dead) msg += ` <span class="text-red">— DEAD</span>`;
      msg += `\n${aug.description}\n`;
      msg += `  Condition ${Math.round(rec.condition * 100)}% (${band?.label || band?.id})`
          +  `  ·  Calibration ${rec.calibration}%`;
      if (rec.install_quality === 'botched') msg += ` <span class="text-red">(capped ${BOTCHED_CALIBRATION_CAP}%)</span>`;
      // The tuning is still on the record; the body around it can't reach it.
      if (fid < rec.calibration) msg += ` <span class="text-red">(held to ${fid}% by the copy)</span>`;
      msg += '\n';
      if (rec.overclock_level > 0 || heat > 1) {
        msg += `  Output ${100 + 25 * rec.overclock_level}%  ·  <span class="${hb.cls}">${hb.label}</span>\n`;
      }
      const s = statLine(aug.stat_modifiers, scale);
      if (s) msg += `  Stats: ${s}\n`;
      const soakTypes = Object.values(aug.soak || {}).flatMap(m => Object.keys(m || {}));
      if (soakTypes.length) msg += `  Soak: ${[...new Set(soakTypes)].join(', ')} (under the skin)\n`;
      msg += '\n';
    }
  }
  const used = {};
  for (const rec of rosterOf(player).values()) used[rec.slot] = (used[rec.slot] || 0) + 1;
  msg += '<span class="skills-header">SLOTS</span>\n';
  for (const [slot, cap] of Object.entries(SLOT_CAPS)) {
    msg += `  ${slot.padEnd(7)} ${used[slot] || 0}/${cap}\n`;
  }
  if (fid < FIDELITY_MAX) {
    const arts = artifactsFor(fid);
    msg += `\n<span class="skills-header">PATTERN FIDELITY</span>\n`
        +  `  <span class="text-red">${fid}%</span> <span style="opacity:.7">— calibration is held here whatever the hardware says. Re-scan at the Vats Registry.</span>\n`;
    for (const a of arts) msg += `  <span style="opacity:.8">· ${a.self}</span>\n`;
  }
  msg += powerLine(player);
  if (mine.length) {
    msg += `\n<span style="opacity:.7">calibrate &lt;name&gt; · augment overclock &lt;name&gt; &lt;level&gt; · augment repair &lt;name&gt; · augment charge</span>`;
  }
  return { type: 'augments', message: msg };
}

async function cmdAugment(args, raw, player) {
  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1).join(' ');
  if (sub === 'install')   return installAugment(rest, player);
  if (sub === 'remove' || sub === 'pull') return removeAugment(rest, player);
  if (sub === 'repair')    return repairAugment(rest, player);
  if (sub === 'quote')     return quoteInstall(rest, player);
  if (sub === 'overclock') return cmdOverclock(args.slice(1), raw, player);
  if (sub === 'charge')    return cmdCharge(args.slice(1), raw, player);
  if (sub === 'calibrate' || sub === 'tune') return cmdCalibrate(args.slice(1), raw, player);
  return listAugments(player);
}

export const commands = {
  augment: cmdAugment,
  augments: cmdAugment,
  calibrate: cmdCalibrate,
  calibrateresolve: cmdCalibrateResolve,
  backup: cmdBackup,
  assurance: cmdAssurance,
};

export const hooks = {
  'player.respawnZone': onRespawnZone,

  // Print artifacts — what a copy of a copy looks like from the outside, and
  // the only reason the fidelity number is a consequence rather than a stat.
  // Nobody in the world remarks on these out loud; they are just true of the
  // body. See artifacts.js for the tone rule.
  'player.appearanceNotes': ({ target, isSelf }) => {
    const arts = artifactsFor(fidelityOf(target));
    if (!arts.length) return undefined;
    return arts.map(a => (isSelf ? a.self : a.other)).join(' ');
  },

  // Nullcraft's target seam. This plugin owns installed chrome, so this plugin
  // describes its attack surfaces; the nullcraft engine imports nothing here.
  'tech.targets': augmentTargets,
};

// The 1m flush and the logout flush both come through here. Heat is deliberately
// NOT flushed — it is memory-only and cooling off on logout is correct.
export { flushAugments, hydrateAugments };

export const _test = {
  loadAugments, findAugment, SLOT_CAPS, contributeAugmentState, onRespawnZone,
  hasCortical, getBackup, CORTICAL, RESTORE_PRICE, hasAugment, recordOf,
  augmentStatBonus, augScale, atClinic, corruptOnDeath, onStrain, heatOf,
  captureRoster, reprintClone, fidelityOf,
};
