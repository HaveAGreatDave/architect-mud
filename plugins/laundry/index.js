/**
 * Laundry — the other hygiene clock.
 *
 * A shower cleans the body and does nothing for the coat you put back on. The
 * engine's hygiene substrate (server/engine/hygiene.js) tracks those separately —
 * `hygiene_washed_at` and `hygiene_laundered_at` — and this is the only thing in
 * the game that resets the second one. That's the whole reason a laundromat is a
 * building and not set dressing: ~94% of rentable units have no bathroom at all,
 * never mind a machine.
 *
 * Deliberately a leaf. It owns no state, no tick and no table: it moves credits
 * through the engine's economy service, clears the contamination map, and stamps
 * a flag. A washing machine is any furniture tagged `washing_machine`; price and
 * cycle time are read off that furniture so a coin laundry and the machine in a
 * penthouse can differ without a line of code.
 */
import { query } from '../../server/models/db.js';
import { getZoneFurniture } from '../../server/engine/world.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { markLaundered, hygieneOf } from '../../server/engine/hygiene.js';
import { hasTag, tagValue } from '../../server/engine/tags.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getZonePowerInfo } from '../../server/engine/environment.js';

const DEFAULT_PRICE = 12;
const DEFAULT_CYCLE_MS = 20000;

// One cycle per player at a time. Runtime-only — a wash interrupted by a restart
// simply didn't happen, and the player keeps their money because we charge at the
// END, not the start.
const cycles = new Map(); // playerId → { timer, zoneId }

const MACHINES = ['washing machine', 'washer', 'laundromat', 'machine'];

function findMachine(zoneId, nameStr) {
  const here = getZoneFurniture(zoneId).filter(f => hasTag(f, 'washing_machine'));
  if (!here.length) return null;
  if (!nameStr) return here[0];
  const q = nameStr.toLowerCase();
  return here.find(f => (f.name || '').toLowerCase().includes(q))
    || (MACHINES.some(m => m.includes(q)) ? here[0] : null);
}

const CYCLE_BEATS = [
  `You feed the slot, thumb the dial, and the drum lurches into motion.`,
  `The machine sloshes through its cycle. Somebody has scratched a phone number into the lid.`,
  `A long spin, loud enough to feel through the floor, and then quiet.`,
];

// The verb. Undefined return = fall through (no machine here), so `launder` in a
// bar doesn't shadow anything and doesn't lie about why it failed.
async function doLaunder(args, raw, player) {
  const target = args.join(' ').replace(/^(my|the|in|at|clothes?)\s*/i, '').trim();
  const machine = findMachine(player.current_zone, target);
  if (!machine) return undefined;

  if (cycles.has(player.id)) {
    return { type: 'error', message: `Your wash is already running. Wait for it.` };
  }
  // A dead grid is a dead machine — same rule the ATM follows. No power row at
  // all means the zone was never wired for it, which reads as mains and is fine.
  const power = getZonePowerInfo(player.current_zone);
  if (machine.power_draw_kw && power && power.status !== 'online') {
    return { type: 'error', message: `The ${machine.name} is dark. No power, no wash.` };
  }

  const price = tagValue(machine, 'wash_price', DEFAULT_PRICE);
  if (price > 0 && (player.credits || 0) < price) {
    return { type: 'error', message: `The slot wants ${price}₵ and you don't have it.` };
  }

  const before = hygieneOf(player);
  const dirty = Object.keys(player.clothing_contamination || {}).length > 0;
  if (!dirty && before.laundry < 0.15) {
    return { type: 'output', message: `Your clothes are as clean as they're going to get. Save the ${price}₵.` };
  }

  const cycleMs = tagValue(machine, 'wash_cycle_ms', DEFAULT_CYCLE_MS);
  const zoneId = player.current_zone;

  const timer = setTimeout(async () => {
    cycles.delete(player.id);
    // Walked out mid-cycle: the machine finishes without you and somebody else
    // gets a free coat. No charge — you never came back for it.
    if (player.current_zone !== zoneId) {
      sendToPlayer(player.id, { type: 'output', message: `<span class="text-dim">Somewhere behind you, a machine finishes a cycle you walked away from.</span>` });
      return;
    }
    if (price > 0) await adjustCredits(player, -price, undefined, 'laundry:wash');

    player.clothing_contamination = {};
    await query(`UPDATE players SET clothing_contamination='{}'::jsonb WHERE id=$1`, [player.id]).catch(() => {});
    await markLaundered(player);

    sendToPlayer(player.id, {
      type: 'output',
      message: `You pull everything out warm and stiff and smelling of nothing at all.${price ? ` (-${price}₵)` : ''}`,
      player_update: { credits: player.credits },
    });
  }, cycleMs);
  timer.unref?.();
  cycles.set(player.id, { timer, zoneId });

  // Staged flavour across the cycle, same shape as bodily's shower ritual.
  CYCLE_BEATS.slice(1).forEach((line, i) => {
    const t = setTimeout(() => {
      if (cycles.get(player.id)?.zoneId === player.current_zone) {
        sendToPlayer(player.id, { type: 'output', message: `<span class="text-dim">${line}</span>` });
      }
    }, Math.round(cycleMs * (i + 1) / CYCLE_BEATS.length));
    t.unref?.();
  });

  return { type: 'output', message: CYCLE_BEATS[0] };
}

export const commands = {
  launder: doLaunder,
  laundry: doLaunder,
};

// Tag-gated so a machine advertises LAUNDER on examine — the verb is useless
// anywhere else, so discovery has to come from the object.
export const specializedActions = [
  { verb: 'launder', requiredTag: 'washing_machine', handler: doLaunder },
];

console.log('[laundry] Plugin loaded.');
