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
 * Deliberately a leaf. It owns no table and no tick: it moves credits through the
 * engine's economy service, clears the contamination map, and stamps a flag. A
 * washing machine is any furniture tagged `washing_machine`; price and cycle time
 * are read off that furniture so a coin laundry and the machine in a penthouse can
 * differ without a line of code.
 *
 * THREE RULES worth knowing before you change any of it.
 *
 * 1. A MACHINE IS A PLACE, NOT A CAPABILITY. The Wash used to be one furniture row
 *    called "row of coin washing machines" that any number of people could run at
 *    once, which is not what a laundromat is. It is four numbered machines now, and
 *    a running one is CLAIMED: `busy` below is the whole mechanism, and the room
 *    tells you so through the engine's `zone.furnitureOccupants` seam — the same
 *    line that says a booth is taken, because it IS the same fact. Do not print an
 *    availability line here; the engine already writes one.
 *
 * 2. YOU HAVE TO TAKE THE CLOTHES OFF. Obvious in a laundromat and the single
 *    thing that gives the two minutes any weight: you spend them undressed, in
 *    public, where anybody can walk in. The gate is `undress`'s own rule — the five
 *    body slots — so accessories stay on and the refusal names the verb that fixes
 *    it. It is checked LAST of the cheap checks, so a broke player is told about
 *    the money before they are told to strip.
 *
 * 3. WE CHARGE AT THE END. A wash interrupted by a restart simply didn't happen
 *    and the player keeps their money. That predates the rest of this and it is
 *    why `busy` can be runtime-only: a restart forgets every claim, and forgetting
 *    a claim is the safe direction to fail.
 */
import { query } from '../../server/models/db.js';
import { getZoneFurniture } from '../../server/engine/world.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { markLaundered, hygieneOf } from '../../server/engine/hygiene.js';
import { hasTag, tagValue } from '../../server/engine/tags.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getZonePowerInfo } from '../../server/engine/environment.js';

const DEFAULT_PRICE = 12;
const DEFAULT_CYCLE_MS = 2 * 60 * 1000;

// The five slots `undress` takes off. Accessories and the wielded weapon are not
// clothing and stay on — matching cmdUndress exactly, so the refusal below can
// name that verb and be telling the truth about what it will do.
const BODY_SLOTS = ['head', 'torso', 'hands', 'legs', 'feet'];

// One cycle per player at a time. Runtime-only — see rule 3.
const cycles = new Map(); // playerId → { timer, zoneId, machineId }

// Which drums are going round. Runtime-only for the same reason, and keyed by
// furniture id because four machines in one room share a head noun and nothing
// else. Cleared by the cycle's own timer, never by a tick.
const busy = new Map(); // furnitureId → { playerId, handle, zoneId, until }

const MACHINES = ['washing machine', 'washer', 'laundromat', 'machine'];

// The machines are named with DIGITS ("number 3 washer") because the room pane
// sorts the free ones by name, and spelled-out numbers sort four, one, three,
// two — a laundromat that looks broken before you have touched it. Nobody types
// a machine that way though, so `launder three` is normalised to `launder 3`.
const NUMBER_WORDS = { one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
const normaliseNumbers = (s) =>
  s.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, w => NUMBER_WORDS[w]);

function machinesIn(zoneId) {
  return getZoneFurniture(zoneId).filter(f => hasTag(f, 'washing_machine'));
}

function isBusy(f) {
  const claim = busy.get(f.id);
  if (!claim) return null;
  if (claim.until <= Date.now()) { busy.delete(f.id); return null; }
  return claim;
}

/**
 * Resolve which drum they meant.
 *   { kind: 'none' }      no machine in this room at all → the verb falls through
 *   { kind: 'unknown' }   a room full of machines, but not one by that name
 *   { kind: 'busy' }      they named ONE machine and it is running
 *   { kind: 'all-busy' }  every candidate is running
 *   { kind: 'ok', machine }
 *
 * ⚠ The match count is what decides whether a name is a CHOICE or a CATEGORY, and
 * it has to. `launder three` matches one row, so it means that machine and a busy
 * one earns a refusal naming who has it. `launder washer` matches all four, so it
 * means "a washer" and must pick a free one — resolving it to the first match the
 * way a single name does would refuse the whole laundromat because number one
 * happens to be going round.
 */
function pickMachine(zoneId, nameStr) {
  const here = machinesIn(zoneId);
  if (!here.length) return { kind: 'none' };
  let pool = here;
  if (nameStr) {
    const q = normaliseNumbers(nameStr.toLowerCase());
    const matches = here.filter(f => (f.name || '').toLowerCase().includes(q));
    if (matches.length === 1) {
      const claim = isBusy(matches[0]);
      return claim ? { kind: 'busy', machine: matches[0], claim } : { kind: 'ok', machine: matches[0] };
    }
    // No row by that name: a generic word for the thing ("washer", "machine")
    // still means "any of them"; anything else is a target that isn't here.
    if (!matches.length && !MACHINES.some(m => m.includes(q))) return { kind: 'unknown', name: nameStr };
    if (matches.length) pool = matches;
  }
  const free = pool.find(f => !isBusy(f));
  return free ? { kind: 'ok', machine: free } : { kind: 'all-busy', total: pool.length };
}

const CYCLE_BEATS = [
  `You feed the slot, thumb the dial, and the drum lurches into motion.`,
  `The machine fills, sloshes, and settles into a rhythm. Somebody has scratched a phone number into the lid.`,
  `Suds climb the porthole and slide back down. There is nothing to do but stand here.`,
  `A long spin, loud enough to feel through the floor, and then quiet.`,
];

// The verb. Undefined return = fall through (no machine here), so `launder` in a
// bar doesn't shadow anything and doesn't lie about why it failed.
async function doLaunder(args, raw, player, broadcast) {
  const target = args.join(' ').replace(/^(my|the|in|at|clothes?)\s*/i, '').trim();
  const pick = pickMachine(player.current_zone, target);
  if (pick.kind === 'none') return undefined;

  if (cycles.has(player.id)) {
    return { type: 'error', message: `Your wash is already running. Wait for it.` };
  }
  if (pick.kind === 'unknown') {
    return { type: 'error', message: `There's no machine called "${pick.name}" here.` };
  }
  if (pick.kind === 'all-busy') {
    return { type: 'error', message: `All ${pick.total} machines are going round. You'll have to wait for one.` };
  }
  if (pick.kind === 'busy') {
    const mine = pick.claim.playerId === player.id;
    return { type: 'error', message: mine
      ? `That's your own wash going round in there.`
      : `The ${pick.machine.name} is mid-cycle. It's ${pick.claim.handle}'s.` };
  }
  const machine = pick.machine;

  // A dead grid is a dead machine — same rule the ATM follows. No power row at
  // all means the zone was never wired for it, which reads as mains and is fine.
  const power = getZonePowerInfo(player.current_zone);
  if (machine.power_draw_kw && power && power.status !== 'online') {
    return { type: 'error', message: `The ${machine.name} is dark. No power, no wash.` };
  }

  const price = tagValue(machine, 'wash_price', DEFAULT_PRICE);
  const before = hygieneOf(player);
  const dirty = Object.keys(player.clothing_contamination || {}).length > 0;
  if (!dirty && before.laundry < 0.15) {
    return { type: 'output', message: `Your clothes are as clean as they're going to get. Save the ${price}₵.` };
  }
  if (price > 0 && (player.credits || 0) < price) {
    return { type: 'error', message: `The slot wants ${price}₵ and you don't have it.` };
  }

  // Rule 2. One round trip for both halves of the question: what is still ON you,
  // and whether there is anything in the pack worth putting in the drum.
  const { rows: [count] } = await query(
    `SELECT COUNT(*) FILTER (WHERE pi.is_equipped = 1 AND pi.slot = ANY($2))                AS worn,
            COUNT(*) FILTER (WHERE pi.is_equipped = 0 AND (i.tags->>'slot') = ANY($2))      AS carried
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1`,
    [player.id, BODY_SLOTS]
  );
  if (Number(count?.worn || 0) > 0) {
    return { type: 'error', message: `You can't wash what you're standing in. <span class="action-link" data-action="undress">undress</span> first. The machine doesn't care that the room can see you.` };
  }
  if (Number(count?.carried || 0) === 0) {
    return { type: 'output', message: `You've got nothing to put in it. Washing an empty drum costs the same as washing a full one.` };
  }

  const cycleMs = tagValue(machine, 'wash_cycle_ms', DEFAULT_CYCLE_MS);
  const zoneId = player.current_zone;
  busy.set(machine.id, { playerId: player.id, handle: player.handle, zoneId, until: Date.now() + cycleMs });

  const timer = setTimeout(async () => {
    cycles.delete(player.id);
    busy.delete(machine.id);
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
  cycles.set(player.id, { timer, zoneId, machineId: machine.id });

  // Staged flavour across the cycle, same shape as bodily's shower ritual.
  CYCLE_BEATS.slice(1).forEach((line, i) => {
    const t = setTimeout(() => {
      if (cycles.get(player.id)?.zoneId === player.current_zone) {
        sendToPlayer(player.id, { type: 'output', message: `<span class="text-dim">${line}</span>` });
      }
    }, Math.round(cycleMs * (i + 1) / CYCLE_BEATS.length));
    t.unref?.();
  });

  broadcast?.(zoneId, { type: 'zone_event', message: `${player.handle} loads the ${machine.name} and steps back from it in their underwear.` }, player.id);
  return { type: 'output', message: CYCLE_BEATS[0] };
}

// Rule 1. The engine's occupancy line already knows how to say a piece is taken,
// so this hands it the fact and writes no prose of its own. Sync-cheap: a Map
// lookup per machine in the room, on the look path.
function onFurnitureOccupants(zone, viewer) {
  if (!busy.size) return undefined;
  const out = {};
  for (const f of machinesIn(zone?.id)) {
    const claim = isBusy(f);
    if (!claim) continue;
    out[f.id] = claim.playerId === viewer?.id ? 'you' : claim.handle;
  }
  return Object.keys(out).length ? out : undefined;
}

// Only ever speaks for a RUNNING machine. `furniture.describe` is a fireHook —
// last non-undefined wins — and the appliances plugin uses it to mark a powered
// piece as unplugged. An idle washer has nothing to add and returning undefined
// is what lets that note survive.
function onFurnitureDescribe(f, viewer) {
  if (!hasTag(f, 'washing_machine')) return undefined;
  const claim = isBusy(f);
  if (!claim) return undefined;
  const left = Math.max(1, Math.round((claim.until - Date.now()) / 1000));
  const whose = claim.playerId === viewer?.id ? 'Yours' : `${claim.handle}'s`;
  return `<span class="text-dim">Mid-cycle. ${whose}, about ${left}s left on it.</span>`;
}

export const commands = {
  launder: doLaunder,
  laundry: doLaunder,
};

export const hooks = {
  'zone.furnitureOccupants': onFurnitureOccupants,
  'furniture.describe': onFurnitureDescribe,
};

// Tag-gated so a machine advertises LAUNDER on examine — the verb is useless
// anywhere else, so discovery has to come from the object.
export const specializedActions = [
  { verb: 'launder', requiredTag: 'washing_machine', handler: doLaunder },
];

// Exposed for the regression harness.
export const _test = { busy, cycles, pickMachine, onFurnitureOccupants, onFurnitureDescribe, DEFAULT_CYCLE_MS };

console.log('[laundry] Plugin loaded.');
