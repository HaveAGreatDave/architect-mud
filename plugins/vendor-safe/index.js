/**
 * vendor-safe plugin
 *
 * Vendor safes are furniture pieces with flags.vendor_safe = true and
 * flags.vendor_npc_id pointing to the vendor NPC whose credits they hold.
 * Credits accumulate in npc.vendor_credits as players make purchases.
 *
 * `hack safe` — attempt to crack the rotating holo-lock and drain the credits.
 * Requires the hacking skill. Difficulty is set by flags.hack_difficulty (default 5).
 * Failed attempts trigger a 5-minute lockout per player.
 */
import { query } from '../../server/models/db.js';
import { getZone } from '../../server/engine/world.js';
import { skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { adjustCredits } from '../../server/engine/economy.js';

// Per-player lockout: Map<playerId, timestampMs>
const _lockout = new Map();
const LOCKOUT_MS = 5 * 60 * 1000;

async function findSafeInZone(zoneId, nameHint) {
  let sql = `SELECT id, name, flags FROM furniture WHERE zone_id=$1 AND flags @> '{"vendor_safe":true}'`;
  const params = [zoneId];
  if (nameHint) { sql += ` AND name ILIKE $2`; params.push(`%${nameHint}%`); }
  sql += ' LIMIT 1';
  const { rows } = await query(sql, params);
  return rows[0] || null;
}

async function cmdHack(args, raw, player) {
  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'error', message: "You're nowhere." };

  const nameHint = args.join(' ') || null;
  const safe = await findSafeInZone(player.current_zone, nameHint);

  if (!safe) {
    return { type: 'error', message: "There's nothing worth hacking here." };
  }

  const flags = safe.flags || {};
  const npcId = flags.vendor_npc_id;
  if (!npcId) return { type: 'error', message: "The safe isn't linked to a vendor. Nothing to steal." };

  // Lockout check
  const lockedUntil = _lockout.get(player.id) || 0;
  if (Date.now() < lockedUntil) {
    const secs = Math.ceil((lockedUntil - Date.now()) / 1000);
    return { type: 'error', message: `Your console is still flagged from the last attempt. Lockout expires in ${secs}s.` };
  }

  // Check if there's anything to take
  const { rows: npcRows } = await query('SELECT id, name, vendor_credits FROM npcs WHERE id=$1', [npcId]);
  if (!npcRows.length) return { type: 'error', message: "Can't resolve the linked account." };
  const npc = npcRows[0];

  if (!npc.vendor_credits || npc.vendor_credits <= 0) {
    return { type: 'output', message: `You probe the lock frequency — the ${safe.name} cycles through its rotation. The accounts are dry. Nothing to take.` };
  }

  const difficulty = flags.hack_difficulty ?? 5;
  const result = await skillCheck(player, 'hacking', difficulty);

  if (result.success) {
    await awardSkillUse(player.id, 'hacking', result.margin);
    const stolen = npc.vendor_credits;
    await adjustCredits(player, stolen);
    await query('UPDATE npcs SET vendor_credits=0 WHERE id=$1', [npcId]);

    const margin = result.margin;
    const flavor = margin >= 4
      ? 'The lock sequence collapses in under two rotations. Clean. No trace.'
      : margin >= 2
        ? 'The frequency pattern gives way after a few cycles. Fast enough.'
        : 'You catch the key on the third rotation. Sloppy, but it opens.';

    return {
      type: 'output',
      message: `You synchronise with the holo-lock's frequency band and spoof the confirm handshake. ${flavor}\n` +
        `The ${safe.name} opens. You extract ${stolen}c from ${npc.name}'s accounts and close it clean.\n` +
        `<span class="ip-gain">+${stolen} credits. Hacking improved.</span>`,
      player_update: { credits: player.credits },
    };
  }

  // Failure
  _lockout.set(player.id, Date.now() + LOCKOUT_MS);
  const badMargin = Math.abs(result.margin);
  if (badMargin >= 4) {
    return {
      type: 'error',
      message: `<span class="text-red">LOCK TRIGGERED.</span> The frequency rotation detected the intrusion pattern and escalated. Your console signature is burned. Five-minute lockout.`,
    };
  }
  return {
    type: 'error',
    message: `The holo-lock's key shifts mid-attempt. You lose the thread. The rotation completes and resets. Five-minute lockout.`,
  };
}

export const commands = { hack: cmdHack };
