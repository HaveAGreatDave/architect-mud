/**
 * Internal pressure system — bowel (digestive_load) and bladder (hydration_load).
 * Both are hidden floats on the player row (0–110+).
 * Threshold messages fire at ~80%+; involuntary release at >110.
 */
import { query } from '../models/db.js';

// How much load consuming food/drink adds.
// Scales with restore value: eating something with +25 hunger adds ~12 load.
export function foodLoad(restoreHunger)  { return (restoreHunger || 0) * 0.5; }
export function drinkLoad(restoreThirst) { return (restoreThirst || 0) * 0.6; }

// Called once per minute from the game loop for each awake player.
// Returns array of private messages to send the player.
export async function tickBodily(player, broadcastFn, zoneBroadcastFn) {
  const messages = [];
  let digestive  = player.digestive_load  || 0;
  let hydration  = player.hydration_load  || 0;
  let changed = false;

  // Natural decay — slow bleed even without relief
  if (digestive > 0)  { digestive  = Math.max(0, digestive  - 1);  changed = true; }
  if (hydration > 0)  { hydration  = Math.max(0, hydration  - 2);  changed = true; }

  // Threshold ambient messages (fire occasionally, not every tick)
  const tickN = player._tickCounter || 0;

  if (digestive >= 80 && digestive < 110 && tickN % 3 === 0) {
    messages.push(pick(DIGESTIVE_PRESSURE));
  }
  if (hydration >= 80 && hydration < 110 && tickN % 3 === 0) {
    messages.push(pick(HYDRATION_PRESSURE));
  }

  // Fart event for nearby zone — no source identified
  if (digestive >= 90 && Math.random() < 0.15) {
    broadcastFn(player.current_zone, { type:'ambient', message:`<span class="msg-ambient">An embarrassing sound breaks the silence nearby.</span>` }, player.id);
  }

  // Overflow — involuntary release
  if (digestive > 110) {
    const msg = await involuntaryBowelRelease(player, broadcastFn);
    messages.push(msg);
    digestive = 0;
    changed = true;
  }
  if (hydration > 110) {
    const msg = await involuntaryBladderRelease(player, broadcastFn);
    messages.push(msg);
    hydration = 0;
    changed = true;
  }

  if (changed) {
    player.digestive_load  = digestive;
    player.hydration_load  = hydration;
    await query('UPDATE players SET digestive_load=$1, hydration_load=$2 WHERE id=$3',
      [digestive, hydration, player.id]);
  }

  return messages;
}

async function stainClothing(player, slots, type) {
  const contamination = player.clothing_contamination || {};
  for (const slot of slots) contamination[slot] = type;
  player.clothing_contamination = contamination;
  await query('UPDATE players SET clothing_contamination=$1 WHERE id=$2',
    [JSON.stringify(contamination), player.id]);
}

async function equippedSlotsFor(player, slotNames) {
  const { rows } = await query(
    `SELECT pi.slot FROM player_inventory pi WHERE pi.player_id=$1 AND pi.is_equipped=1 AND pi.slot = ANY($2)`,
    [player.id, slotNames]
  );
  return rows.map(r => r.slot);
}

async function involuntaryBowelRelease(player, broadcastFn) {
  const coveredSlots = await equippedSlotsFor(player, ['legs']);
  if (coveredSlots.length) await stainClothing(player, coveredSlots, 'feces');
  broadcastFn(player.current_zone, { type:'zone_event', message:`Something smells suddenly and sharply wrong nearby.` }, player.id);
  player.digestive_load = 0;
  return `<span style="color:var(--red)">Your body gives out. You lose control entirely. Your clothing is stained. The world will notice.</span>`;
}

async function involuntaryBladderRelease(player, broadcastFn) {
  const coveredSlots = await equippedSlotsFor(player, ['legs']);
  if (coveredSlots.length) await stainClothing(player, coveredSlots, 'urine');
  broadcastFn(player.current_zone, { type:'zone_event', message:`A small puddle spreads near someone's feet.` }, player.id);
  player.hydration_load = 0;
  return `<span style="color:var(--red)">You can't hold it any longer. It just… happens. Your clothing is wet. You stand very still for a moment.</span>`;
}

// Actual relief — called by pee/poop commands
// target: optional { type: 'toilet'|'ground'|'player'|'furniture', name: string, target: playerObj }
export async function relieveBladder(player, hasFacility, broadcast, target = null) {
  if ((player.thirst || 0) === 0) {
    return { ok: false, message: `You're too dehydrated. There's nothing to release.` };
  }

  // Pissing on a player
  if (target?.type === 'player') {
    const tp = target.target;
    const reduction = 55;
    player.hydration_load = Math.max(0, (player.hydration_load || 0) - reduction);
    await query('UPDATE players SET hydration_load=$1 WHERE id=$2', [player.hydration_load, player.id]);
    broadcast(player.current_zone, {
      type: 'zone_event',
      message: `${player.handle} pisses on ${tp.handle}.`,
    }, player.id, tp.id);
    broadcast(null, { type: 'output', message: `${player.handle} pisses on you.` }, null, tp.id);
    return { ok: true, message: `You piss on ${tp.handle}.` };
  }

  const covered = await equippedSlotsFor(player, ['legs']);
  let stained = false;
  if (!hasFacility && covered.length) {
    await stainClothing(player, covered, 'urine');
    stained = true;
  }
  const reduction = hasFacility ? 65 : 55;
  player.hydration_load = Math.max(0, (player.hydration_load || 0) - reduction);
  await query('UPDATE players SET hydration_load=$1 WHERE id=$2', [player.hydration_load, player.id]);

  if (hasFacility) {
    return { ok: true, message: pick(TOILET_PEE_MSGS), private: true };
  }
  broadcast(player.current_zone, { type:'zone_event', message: `A stream hits the ground nearby.` }, player.id);
  return {
    ok: true,
    message: stained
      ? `You go where you stand. Your ${covered[0] || 'clothing'} absorbs most of it.`
      : pick(GROUND_PEE_MSGS),
  };
}

export async function relieveBowels(player, hasFacility, broadcast, target = null) {
  if ((player.hunger || 0) === 0) {
    return { ok: false, message: `You haven't eaten enough to produce anything.` };
  }

  // Shitting on a player (must be lying/sleeping)
  if (target?.type === 'player') {
    const tp = target.target;
    const reduction = 60;
    player.digestive_load = Math.max(0, (player.digestive_load || 0) - reduction);
    await query('UPDATE players SET digestive_load=$1 WHERE id=$2', [player.digestive_load, player.id]);
    broadcast(player.current_zone, {
      type: 'zone_event',
      message: `${player.handle} squats over ${tp.handle} and shits on them.`,
    }, player.id, tp.id);
    broadcast(null, { type: 'output', message: `${player.handle} squats over you and shits on you.` }, null, tp.id);
    return { ok: true, message: `You squat over ${tp.handle} and do it. That's a statement.` };
  }

  // Shitting on furniture
  if (target?.type === 'furniture') {
    const reduction = 60;
    player.digestive_load = Math.max(0, (player.digestive_load || 0) - reduction);
    await query('UPDATE players SET digestive_load=$1 WHERE id=$2', [player.digestive_load, player.id]);
    broadcast(player.current_zone, {
      type: 'zone_event',
      message: `The smell of something biological hits the air near the ${target.name}.`,
    }, player.id);
    return { ok: true, message: `You squat over the ${target.name} and relieve yourself on it. It needed that.` };
  }

  const covered = await equippedSlotsFor(player, ['legs']);
  let stained = false;
  if (!hasFacility && covered.length) {
    await stainClothing(player, covered, 'feces');
    stained = true;
  }
  const reduction = hasFacility ? 75 : 60;
  player.digestive_load = Math.max(0, (player.digestive_load || 0) - reduction);
  await query('UPDATE players SET digestive_load=$1 WHERE id=$2', [player.digestive_load, player.id]);

  if (hasFacility) {
    return { ok: true, message: pick(TOILET_POOP_MSGS), private: true };
  }
  broadcast(player.current_zone, { type:'zone_event', message: `The smell of something biological drifts through the air.` }, player.id);
  return {
    ok: true,
    message: stained
      ? `You go where you stand. Your clothing is stained. Dignity: impacted.`
      : pick(GROUND_POOP_MSGS),
  };
}

const TOILET_PEE_MSGS = [
  `You use the toilet. Relief washes over you.`,
  `You sit down and handle your business. Much better.`,
  `A long, satisfying stream. You feel significantly lighter.`,
];
const TOILET_POOP_MSGS = [
  `You take care of business. A profound sense of relief.`,
  `You use the facilities. The weight of the world, literally, lifts.`,
  `Done. You feel like a new person. Marginally.`,
];
const GROUND_PEE_MSGS = [
  `You relieve yourself on the ground.`,
  `You piss where you stand. No ceremony.`,
  `A long stream hits the concrete. Better out than in.`,
];
const GROUND_POOP_MSGS = [
  `You squat and take care of business on the ground. No one can judge you. (You can judge yourself.)`,
  `You find a spot, crouch, and handle it. Desperate times.`,
  `You take a shit on the ground. The post-singularity hasn't improved this experience.`,
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const DIGESTIVE_PRESSURE = [
  `Your stomach shifts uncomfortably.`,
  `A low gurgling echoes from within you. You ignore it. It doesn't care.`,
  `Something inside you makes its demands known.`,
  `Your gut is sending you a very clear message.`,
  `The pressure building in your abdomen is becoming hard to ignore.`,
];

const HYDRATION_PRESSURE = [
  `You feel increasing internal pressure. Structural.`,
  `A growing sense of urgency develops somewhere you'd rather not think about.`,
  `Your bladder registers a formal complaint.`,
  `The pressure is reaching a point where it's affecting your concentration.`,
  `You really need to find a bathroom soon.`,
];
