/**
 * Bodily plugin — bowel/bladder pressure (digestive_load / hydration_load,
 * hidden 0–110+ floats on the player row), threshold messages, involuntary
 * release, and the pee/poop/flush verbs. Extracted from engine/bodily.js +
 * commands/bodily.js (Phase 2, docs/proposals/engine-plugin-boundary.md).
 *
 * The engine keeps the substrate half of the old module: stains
 * (stainClothing/stainZone — also written by mis and butchering) and the
 * digestion loads (foodLoad/drinkLoad/applyThirst — read by drugs, inventory,
 * fillable, water). This plugin owns the pressure simulation and the verbs.
 *
 * SIFT ambiguous picks replay through the bodily.pee_target / bodily.poop_target
 * Actions (the builtin replay path can't reach plugin verbs).
 */
import { query } from '../../server/models/db.js';
import { stainClothing, stainZone } from '../../server/engine/bodily.js';
import { isMisActive } from '../../server/engine/mis.js';
import { getZonePlayers, getAllLivePlayers } from '../../server/engine/world.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { registerAction } from '../../server/engine/actions.js';
import { schedule } from '../../server/engine/scheduler.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';

// ── Pressure simulation (was engine tickBodily, on gameLoop's minute tick) ───

async function equippedSlotsFor(player, slotNames) {
  const { rows } = await query(
    `SELECT pi.slot FROM player_inventory pi WHERE pi.player_id=$1 AND pi.is_equipped=1 AND pi.slot = ANY($2)`,
    [player.id, slotNames]
  );
  return rows.map(r => r.slot);
}

async function involuntaryBowelRelease(player) {
  const coveredSlots = await equippedSlotsFor(player, ['legs']);
  if (coveredSlots.length) await stainClothing(player, coveredSlots, 'feces');
  await stainZone(player.current_zone, 'feces');
  sendToZone(player.current_zone, { type:'zone_event', message:`Something smells suddenly and sharply wrong nearby.` }, player.id);
  player.digestive_load = 0;
  return `<span style="color:var(--red)">Your body gives out. You lose control entirely. Your clothing is stained. The world will notice.</span>`;
}

async function involuntaryBladderRelease(player) {
  const coveredSlots = await equippedSlotsFor(player, ['legs']);
  if (coveredSlots.length) await stainClothing(player, coveredSlots, 'urine');
  await stainZone(player.current_zone, 'urine');
  sendToZone(player.current_zone, { type:'zone_event', message:`A small puddle spreads near someone's feet.` }, player.id);
  player.hydration_load = 0;
  return `<span style="color:var(--red)">You can't hold it any longer. It just… happens. Your clothing is wet. You stand very still for a moment.</span>`;
}

// Once per minute for each awake player (sleeping players' meters pause, same
// as the old engine tick, which skipped them).
async function tickBodily(player) {
  const messages = [];
  let digestive  = player.digestive_load  || 0;
  let hydration  = player.hydration_load  || 0;
  let changed = false;

  // Natural decay — slow bleed even without relief
  if (digestive > 0)  { digestive  = Math.max(0, digestive  - 1);  changed = true; }
  if (hydration > 0)  { hydration  = Math.max(0, hydration  - 2);  changed = true; }

  // Threshold ambient messages (fire occasionally, not every tick).
  // _tickCounter is maintained by the engine resource tick.
  const tickN = player._tickCounter || 0;

  if (digestive >= 80 && digestive < 110 && tickN % 3 === 0) {
    messages.push(pick(DIGESTIVE_PRESSURE));
  }
  if (hydration >= 80 && hydration < 110 && tickN % 3 === 0) {
    messages.push(pick(HYDRATION_PRESSURE));
  }

  // Fart event for nearby zone — no source identified
  if (digestive >= 90 && Math.random() < 0.15) {
    sendToZone(player.current_zone, { type:'ambient', message:`<span class="msg-ambient">An embarrassing sound breaks the silence nearby.</span>` }, player.id);
  }

  // Overflow — involuntary release
  if (digestive > 110) {
    messages.push(await involuntaryBowelRelease(player));
    digestive = 0;
    changed = true;
  }
  if (hydration > 110) {
    messages.push(await involuntaryBladderRelease(player));
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

schedule('1m', async () => {
  for (const player of getAllLivePlayers()) {
    if (player.sleeping) continue;
    const messages = await tickBodily(player);
    if (messages.length) sendToPlayer(player.id, { type: 'resource_tick', messages });
  }
});

// ── Relief (was engine relieveBladder/relieveBowels) ─────────────────────────
// target: optional { type: 'toilet'|'ground'|'player'|'furniture', name, target: playerObj }

async function relieveBladder(player, hasFacility, broadcast, target = null) {
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
  await stainZone(player.current_zone, 'urine');
  broadcast(player.current_zone, { type:'zone_event', message: `A stream hits the ground nearby.` }, player.id);
  return {
    ok: true,
    message: stained
      ? `You go where you stand. Your ${covered[0] || 'clothing'} absorbs most of it.`
      : pick(GROUND_PEE_MSGS),
  };
}

async function relieveBowels(player, hasFacility, broadcast, target = null) {
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
  await stainZone(player.current_zone, 'feces');
  broadcast(player.current_zone, { type:'zone_event', message: `The smell of something biological drifts through the air.` }, player.id);
  return {
    ok: true,
    message: stained
      ? `You go where you stand. Your clothing is stained. Dignity: impacted.`
      : pick(GROUND_POOP_MSGS),
  };
}

// ── Verbs (was commands/bodily.js) ───────────────────────────────────────────

async function hasFacilityNearby(zoneId) {
  const { rows } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND (object_type='toilet' OR jsonb_exists(flags,'toilet')) LIMIT 1`,
    [zoneId]
  );
  return rows.length > 0;
}

// Resolve an optional target from raw command args (e.g. "pee on alice" / "shit on bed")
async function resolveBodilyTarget(args, player, dispatchType) {
  // Expect "on <name>", "in <name>", or just no args
  const str = args.join(' ').replace(/^(?:on|in)\s+/i, '').trim();
  if (!str) return null;

  // Check for player target in zone using SIFT
  const others = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  const candidates = others.map(p => ({ ...p, name: p.handle }));
  const r = siftResolve(str, candidates);
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { dispatchType, dispatchParam: 'target' });
    return { type: 'ambiguous', selection: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  if (r.type === 'match') return { type: 'player', target: r.candidate };

  // Check for sleeping body
  const { rows: sleepers } = await query(
    `SELECT * FROM players WHERE LOWER(handle) LIKE $1 AND current_zone=$2 AND offline_sleeping=TRUE LIMIT 1`,
    [`%${str.toLowerCase()}%`, player.current_zone]
  );
  if (sleepers.length) return { type: 'player', target: sleepers[0] };

  // Check for furniture with sit command (for shit) or just any furniture (for pee)
  const { rows: furniture } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND name ILIKE $2 LIMIT 1`,
    [player.current_zone, `%${str}%`]
  );
  if (furniture.length) return { type: 'furniture', target: furniture[0], name: furniture[0].name };

  return null;
}

async function peeOnPlayer(player, tp, broadcast) {
  if (!isMisActive(player)) return { type:'error', message:`That requires MIS to be enabled.` };
  const result = await relieveBladder(player, false, broadcast, { type: 'player', target: tp });
  return { type: result.ok ? 'output' : 'error', message: result.message };
}

async function poopOnPlayer(player, tp, broadcast) {
  if (!isMisActive(player)) return { type:'error', message:`That requires MIS to be enabled.` };
  // Target must be sleeping or lying down (posture substrate read)
  if (!tp.sleeping && !tp.offline_sleeping && tp.posture !== 'lying') {
    return { type:'error', message:`${tp.handle || 'They'} would have to be lying down for that.` };
  }
  const result = await relieveBowels(player, false, broadcast, { type: 'player', target: tp });
  return { type: result.ok ? 'output' : 'error', message: result.message };
}

async function cmdPee(args, player, broadcast) {
  const target = await resolveBodilyTarget(args, player, 'bodily.pee_target');
  if (target?.type === 'ambiguous') return { type:'output', message: target.selection };
  if (target?.type === 'player') return peeOnPlayer(player, target.target, broadcast);
  if (target?.type === 'furniture') {
    const f = target.target;
    if (f.object_type !== 'toilet') return { type:'error', message:`You can't do that in the ${f.name}.` };
    const result = await relieveBladder(player, true, broadcast);
    return { type: result.ok ? 'output' : 'error', message: result.message };
  }
  const hasFacility = await hasFacilityNearby(player.current_zone);
  const result = await relieveBladder(player, hasFacility, broadcast);
  return { type: result.ok ? 'output' : 'error', message: result.message };
}

async function cmdPoop(args, player, broadcast) {
  const target = await resolveBodilyTarget(args, player, 'bodily.poop_target');
  if (target?.type === 'ambiguous') return { type:'output', message: target.selection };
  if (target?.type === 'player') return poopOnPlayer(player, target.target, broadcast);
  if (target?.type === 'furniture') {
    const f = target.target;
    const isToilet = f.object_type === 'toilet' || f.flags?.toilet;
    const hasSit = f.flags?.interactions?.includes?.('sit') || isToilet;
    if (!hasSit) return { type:'error', message:`You can't do that on the ${f.name}.` };
    if (isToilet) {
      const result = await relieveBowels(player, true, broadcast);
      return { type: result.ok ? 'output' : 'error', message: result.message };
    }
    const result = await relieveBowels(player, false, broadcast, { type: 'furniture', name: f.name });
    return { type: result.ok ? 'output' : 'error', message: result.message };
  }
  const hasFacility = await hasFacilityNearby(player.current_zone);
  const result = await relieveBowels(player, hasFacility, broadcast);
  return { type: result.ok ? 'output' : 'error', message: result.message };
}

async function cmdFlush(args, player) {
  const { rows } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND (object_type='toilet' OR jsonb_exists(flags,'toilet')) LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return { type:'error', message:`There's no toilet here to flush.` };
  return { type:'output', message:`You flush. The sound is deeply satisfying.` };
}

// SIFT selection replays for the on-player variants.
registerAction({
  type: 'bodily.pee_target',
  handler: ({ actor, params, context }) => peeOnPlayer(actor, params.target, context.broadcast),
});
registerAction({
  type: 'bodily.poop_target',
  handler: ({ actor, params, context }) => poopOnPlayer(actor, params.target, context.broadcast),
});

// ── `use toilet` / `use sink` panels ─────────────────────────────────────────
// (Previously dead code — commands/bodily.js exported bodilyUseHandler but
// nothing ever called it. Wired here as a self-gated `use` specialized action.)

async function cmdUseToilet(player) {
  const { rows } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND (object_type='toilet' OR jsonb_exists(flags,'toilet')) LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return undefined;

  const t = rows[0];
  const peeLink   = `<span class="action-link" data-action="pee" data-target="">pee</span>`;
  const poopLink  = `<span class="action-link" data-action="poop" data-target="">poop</span>`;
  const flushLink = `<span class="action-link" data-action="flush" data-target="">flush</span>`;

  let msg = `${t.name}\n${t.description}`;
  msg += `\n<span class="text-dim">Actions:</span> ${peeLink}  ${poopLink}  ${flushLink}`;

  if (isMisActive(player)) {
    msg += `\n<span class="text-dim">The stall offers a moment of total privacy.</span>`;
  }

  return { type:'output', message: msg };
}

async function cmdUseSink(player) {
  const { rows } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND (object_type='sink' OR jsonb_exists(flags,'water_source')) LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return undefined;

  const s = rows[0];
  const washHandsLink = `<span class="action-link" data-action="wash" data-target="hands">wash hands</span>`;
  const washLink      = `<span class="action-link" data-action="wash" data-target="">wash</span>`;

  let msg = `${s.name}\n${s.description}`;
  msg += `\n<span class="text-dim">Actions:</span> ${washHandsLink}  ${washLink}`;

  if (isMisActive(player)) {
    msg += `\n<span class="text-dim">The running water is cold and good for cleaning up after intimate encounters.</span>`;
  }

  return { type:'output', message: msg };
}

export const specializedActions = [{
  verb: 'use',
  handler: async (args, raw, player) => {
    const target = args.filter(a => a !== 'on').join(' ').toLowerCase();
    if (!target) return undefined; // bare `use` stays with the inventory builtin
    if (target.includes('toilet')) return cmdUseToilet(player);
    if (target.includes('sink') || target.includes('faucet') || target.includes('tap')) return cmdUseSink(player);
    return undefined;
  },
}];

export const commands = {
  pee:      (args, raw, player, broadcast) => cmdPee(args, player, broadcast),
  urinate:  (args, raw, player, broadcast) => cmdPee(args, player, broadcast),
  piss:     (args, raw, player, broadcast) => cmdPee(args, player, broadcast),
  poop:     (args, raw, player, broadcast) => cmdPoop(args, player, broadcast),
  defecate: (args, raw, player, broadcast) => cmdPoop(args, player, broadcast),
  shit:     (args, raw, player, broadcast) => cmdPoop(args, player, broadcast),
  flush:    (args, raw, player)            => cmdFlush(args, player),
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

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

console.log('[bodily] Plugin loaded.');
