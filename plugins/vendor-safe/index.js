/**
 * vendor-safe plugin
 *
 * Vendor safes are furniture pieces with flags.vendor_safe = true and
 * flags.vendor_npc_id pointing to the vendor NPC whose credits they hold.
 * Credits accumulate in npc.vendor_credits as players make purchases.
 *
 * `hack safe` — arm a VAULT CRACK breach of the rotating combination lock. No
 * skill roll gates arming it: the client-side minigame (see panels/vaultcrack.js
 * via dispatch.js's `vault_crack` route) is what decides success, reported back
 * via `safecrackresolve`, which is authoritative for the outcome AND re-reads
 * the credits server-side so the payout can't be spoofed. A failed attempt
 * triggers a 5-minute lockout per player.
 */
import { query } from '../../server/models/db.js';
import { textRender } from '../../server/engine/minigame.js';
import { getZone, getZoneNpcs, world, updateNpc } from '../../server/engine/world.js';
import { effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { emit } from '../../server/engine/events.js';
import { holdVendorGrudge } from '../../server/engine/vendor-grudge.js';
import { hackDifficulty, damageHackDeck, breachMargin, hasHackDeck } from '../../server/engine/hack-gear.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { neighborZoneIds } from '../../server/engine/exits.js';
import { disturbSleeper, isNpcAsleep } from '../../server/engine/ai-behaviour.js';

// ── The night alarm ──────────────────────────────────────────────────────────
//
// A vendor standing over their own safe was, until now, the ONLY thing that made
// cracking one risky: `vendorHere` forces a witness and the wanted stars follow.
// Which meant the correct way to rob every safe in the city was to come back at
// 3am, when the shop is locked, the owner is asleep across town and there is
// nobody in the room to see it. Perfect information, zero risk, every time.
//
// So the safe watches its own shop after dark. The tamper circuit arms when the
// owner ISN'T standing there and it's dark out — exactly the conditions that
// made it free — and jacking in trips it: a siren in the room, audible in every
// adjoining room, sleepers next door on their feet, and the same forced witness
// a present owner is. It fires at ARM time, not on success, because an alarm you
// only hear after the money's gone isn't an alarm, it's a receipt.
//
// Daylight with the owner out (lunch, a supply run) is deliberately still quiet:
// that's a burglary you had to time, and timing it is the skill.
const ALARM_PHASES = new Set(['night', 'dusk']);

function alarmArmed(zoneId, vendorHere) {
  if (vendorHere) return false;                      // they ARE the alarm
  return ALARM_PHASES.has(getEnvironmentState().phase);
}

// Loud enough to carry one room. Anyone asleep next door gets up — a siren going
// off through the wall is the least ambiguous wake-up in the game.
function soundAlarm(safe, player, zoneId, broadcast) {
  broadcast(zoneId, {
    type: 'zone_event',
    message: `<span class="text-red">A tamper contact breaks somewhere inside the ${safe.name} and the whole cabinet starts SHRIEKING — a flat electronic howl, loud enough to hurt.</span>`,
    refresh: true,
  });
  for (const neighbourId of neighborZoneIds(getZone(zoneId)) || []) {
    broadcast(neighbourId, { type: 'zone_event', message: `An alarm goes off nearby — a hard, flat shriek, close enough to feel in your teeth.` });
    for (const npc of getZoneNpcs(neighbourId) || []) {
      if (isNpcAsleep(npc)) disturbSleeper(npc, { broadcast, force: true });
    }
  }
  emit('vendor.safeHackWitnessed', { player, zoneId });
}

// Per-player lockout: Map<playerId, timestampMs>
const _lockout = new Map();
const LOCKOUT_MS = 5 * 60 * 1000;

// Per-player armed breach (anti-spoof): Map<playerId, { safeId, expires }>
const _pending = new Map();
const PENDING_TTL_MS = 180 * 1000;

async function findSafeInZone(zoneId, nameHint) {
  let sql = `SELECT id, name, flags FROM furniture WHERE zone_id=$1 AND flags @> '{"vendor_safe":true}'`;
  const params = [zoneId];
  if (nameHint) { sql += ` AND name ILIKE $2`; params.push(`%${nameHint}%`); }
  sql += ' LIMIT 1';
  const { rows } = await query(sql, params);
  return rows[0] || null;
}

async function findSafeById(safeId, zoneId) {
  const { rows } = await query(
    `SELECT id, name, flags FROM furniture WHERE id=$1 AND zone_id=$2 AND flags @> '{"vendor_safe":true}' LIMIT 1`,
    [safeId, zoneId]
  );
  return rows[0] || null;
}

async function cmdHack(args, raw, player, broadcast) {
  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'error', message: "You're nowhere." };

  const nameHint = args.join(' ') || null;
  const safe = await findSafeInZone(player.current_zone, nameHint);

  // No safe here — fall through so other `hack` targets (e.g. a hackable
  // hololock door, the doors plugin's `hack` action) get a chance to claim it.
  if (!safe) return undefined;

  const flags = safe.flags || {};
  const npcId = flags.vendor_npc_id;
  if (!npcId) return { type: 'error', message: "The safe isn't linked to a vendor. Nothing to steal." };

  // You need a deck. This gate was missing, which made the vendor safe the one
  // strongbox in the city you could open with your bare hands — while the ATM
  // (plugins/atm cmdJack), the hololock (commands/doors hackDoor) and even the
  // PRACTICE rig all demanded hardware. It also made `hack_penalty` /
  // `hack_fail_damage` meaningless here: WHICH deck you carry is supposed to decide
  // how hard the safe reads and what a bungled attempt costs you, and with no deck
  // there was nothing to read from and nothing to damage. Placed after the
  // `return undefined` self-gate above so other `hack` targets still get their turn,
  // and before the lockout so an empty-handed attempt can't burn five minutes.
  if (!(await hasHackDeck(player.id))) {
    return { type: 'error', message: `The ${safe.name} has a keypad, a comm port and no sense of humour. You need a hacking device to get into it.` };
  }

  // Lockout check
  const lockedUntil = _lockout.get(player.id) || 0;
  if (Date.now() < lockedUntil) {
    const secs = Math.ceil((lockedUntil - Date.now()) / 1000);
    return { type: 'error', message: `Your rig is still flagged from the last attempt. Lockout expires in ${secs}s.` };
  }

  // Check if there's anything to take (world.npcs is funnel-synced for vendor_credits)
  const npc = world.npcs.get(npcId);
  if (!npc) return { type: 'error', message: "Can't resolve the linked account." };

  if (!npc.vendor_credits || npc.vendor_credits <= 0) {
    return { type: 'output', message: `You put an ear to the ${safe.name} and spin the dial — the tumblers are the least of it. The accounts are dry. Nothing to take.` };
  }

  // If the safe's owner is standing right here, they catch you jacking in — a
  // shopkeeper does not calmly watch someone crack their strongbox. They lose
  // it, and as a guaranteed witness they raise the alarm (→ hacking wanted
  // stars, routed through surveillance's `vendor.safeHackWitnessed` listener).
  // The breach still launches — you're doing it brazenly, in their face.
  const vendorHere = (getZoneNpcs(player.current_zone) || []).some(n => n.id === npcId);
  if (vendorHere) {
    broadcast(player.current_zone, {
      type: 'zone_event',
      message: `<span class="text-red">${npc.name} catches ${player.handle} jacking a deck into the ${safe.name} and completely loses it: "HEY! THIEF! Get AWAY from that!"</span>`,
    });
    emit('vendor.safeHackWitnessed', { player, zoneId: player.current_zone });
    await holdVendorGrudge(player, npcId);   // caught in the act — they won't trade with you
  } else if (alarmArmed(player.current_zone, vendorHere)) {
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} jacks a deck into the ${safe.name} and starts working the dial.` }, player.id);
    soundAlarm(safe, player, player.current_zone, broadcast);
    await holdVendorGrudge(player, npcId);   // they come back to a screaming safe and a log with your name on it
  } else {
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} jacks a deck into the ${safe.name} and starts working the dial.` }, player.id);
  }

  _pending.set(player.id, { safeId: safe.id, expires: Date.now() + PENDING_TTL_MS });
  return textRender(player, {
    type: 'vault_crack',
    safeId: safe.id,
    deviceName: safe.name,
    skill: await effectiveSkill(player, 'hacking'),
    difficulty: await hackDifficulty(player.id, flags.hack_difficulty),
    resolveCmd: 'safecrackresolve',
  });
}

// safecrackresolve <safeId> <1|0> — silent; the Vault Crack overlay fires this
// with the minigame's own outcome. That outcome is authoritative (winning the
// minigame is the gate); the credits are re-read here so the payout is honest.
async function cmdSafeCrackResolve(args, raw, player) {
  const safeId = args[0];
  const win = args[1] === '1';
  if (!safeId) return { type: 'noop' };

  // Must match a breach this player actually armed (anti-spoof), still fresh.
  const pending = _pending.get(player.id);
  _pending.delete(player.id);
  if (!pending || pending.safeId !== safeId || Date.now() > pending.expires) return { type: 'noop' };

  const safe = await findSafeById(safeId, player.current_zone);
  if (!safe) return { type: 'noop' };
  const npcId = (safe.flags || {}).vendor_npc_id;
  if (!npcId) return { type: 'noop' };

  if (!win) {
    _lockout.set(player.id, Date.now() + LOCKOUT_MS);
    // The deck eats the tamper response, same as a botched ATM jack — one rule
    // for what a failed breach costs your gear, wherever you failed it.
    const deckMsg = await damageHackDeck(player.id);
    return { type: 'error', message: `The combination re-seats mid-spin and the tamper sensor logs the attempt. Your rig is flagged — five-minute lockout.${deckMsg}` };
  }

  const npc = world.npcs.get(npcId);
  if (!npc) return { type: 'noop' };
  if (!npc.vendor_credits || npc.vendor_credits <= 0) {
    return { type: 'output', message: `The ${safe.name} swings open — but the accounts ran dry before you cracked it. Nothing to take.` };
  }

  const stolen = npc.vendor_credits;
  await adjustCredits(player, stolen, undefined, 'vendorsafe:loot');
  await updateNpc(npcId, { vendor_credits: 0 });
  await awardSkillUse(player.id, 'hacking', await breachMargin(player, (safe.flags || {}).hack_difficulty));
  // Robbed blind — the vendor holds a grudge even if they never caught you in
  // the act (they come back to a drained safe and know exactly who to blame).
  await holdVendorGrudge(player, npcId);
  // Breaching a live device is hacking — charged (witness-gated) if a camera,
  // cop, or bystander catches the completed crack, mirroring the ATM/hololock
  // path. The owner-present case is already charged at arm time (forced witness).
  emit('hack.success', { player, zoneId: player.current_zone });

  return {
    type: 'output',
    message: `The last tumbler drops and the bolt slides back. The ${safe.name} swings open.\n` +
      `You extract ${stolen}c from ${npc.name}'s accounts and ease it shut behind you.\n` +
      `<span class="ip-gain">+${stolen} credits. Hacking improved.</span>`,
    player_update: { credits: player.credits },
  };
}

// `hack` is tag-gated on the safe furniture (flags.vendor_safe) so examining a
// vendor safe advertises it via availableActions. The handler still self-gates
// (returns undefined when no safe is present) so a hacked hololock door still
// claims the verb through the doors plugin.
// Fair warning, and the only warning. A trap the player can't see before they
// spring it is a gotcha; a red LED on the fascia is a decision. The line reads
// the SAME condition `alarmArmed` does, so the tell can never disagree with the
// mechanic — and it goes quiet in daylight, which is the game telling you when
// to come back.
export const hooks = {
  'furniture.describe': (f, player) => {
    if (!f?.flags?.vendor_safe) return undefined;
    const zoneId = f.zone_id || player?.current_zone;
    if (!zoneId) return undefined;
    const vendorHere = (getZoneNpcs(zoneId) || []).some(n => n.id === f.flags.vendor_npc_id);
    if (!alarmArmed(zoneId, vendorHere)) return undefined;
    return `<span class="text-red">A pinhead LED on the fascia is showing red. The tamper circuit is live — this thing is listening for hands after dark.</span>`;
  },
};

export const specializedActions = [
  { verb: 'hack', requiredTag: 'vendor_safe', handler: cmdHack },
];

export const commands = { safecrackresolve: cmdSafeCrackResolve };

// Test seam.
export const _test = { alarmArmed, ALARM_PHASES };
