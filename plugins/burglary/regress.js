// Burglary alarm regression — drives the intrusion events against a throwaway
// in-memory NPC + zone and asserts the detection state transitions. No DB rows;
// the fake zone/npc are injected into the live world and removed in finally.
import { emit } from '../../server/engine/events.js';
import { world } from '../../server/engine/world.js';
import { fireHook } from '../../server/engine/plugins.js';

export default async function regress({ check }) {
  const zid = '__burg_test_zone__';
  const npcId = '__burg_test_npc__';
  const intruder = '__burg_test_intruder__';
  const npc = { id: npcId, name: 'Test Resident', zone_id: zid, home_zone: zid, hp: 10, _ai: { homeSleeping: false } };
  const attempt = (method) => emit('breakin.attempt', { intruderId: intruder, entranceZoneId: '__burg_hall__', unitZoneIds: [zid], method });

  const hadZone = world.zones.get(zid);
  world.zones.set(zid, { id: zid, map_id: 'map_burg_test', npcs: new Set([npcId]), enemies: new Set() });
  world.npcs.set(npcId, npc);

  try {
    // An awake resident hears the pick immediately (100%) and is taken over.
    attempt('hack');
    check('awake resident alarms on pick', npc._ai.alarm === true, `alarm=${npc._ai.alarm}`);
    check('alarm wakes NPC to standing', npc.posture === 'standing', `posture=${npc.posture}`);

    // Killing the resident cancels the alarm (no report path).
    emit('npc.killed', { npc });
    check('kill clears the alarm', !npc._ai.alarm, `alarm=${npc._ai.alarm}`);

    // A sleeping resident is NOT auto-woken by a plain pick event (only the tick rolls it).
    npc._ai = { homeSleeping: true };
    attempt('hack');
    check('sleeping resident not auto-woken by a pick', npc._ai.alarm !== true, `alarm=${npc._ai.alarm}`);

    // ...but a bashed door is loud enough to wake them on the spot.
    attempt('bash');
    check('bash wakes a sleeping resident', npc._ai.alarm === true, `alarm=${npc._ai.alarm}`);

    // Noise (yell/say) from the intruder wakes a still-asleep resident too.
    emit('npc.killed', { npc });            // clear the bash alarm + timers
    npc._ai = { homeSleeping: true };
    emit('player.spoke', { player: { id: intruder }, zoneId: zid, loud: true });
    check('intruder noise wakes a sleeping resident', npc._ai.alarm === true, `alarm=${npc._ai.alarm}`);

    emit('npc.killed', { npc });            // cleanup timers
  } finally {
    world.npcs.delete(npcId);
    if (hadZone) world.zones.set(zid, hadZone); else world.zones.delete(zid);
  }

  // ── Forcefield gate: an active break-in denies the safe-sleep forcefield ─────
  // (works for a player-owned unit with no NPCs — the point of this gate). A
  // throwaway intruder-player stands in a throwaway unit zone.
  const unit = '__burg_ff_unit__';
  const ffIntruder = '__burg_ff_intruder__';
  const hadUnit = world.zones.get(unit);
  world.zones.set(unit, { id: unit, map_id: 'map_burg_ff', npcs: new Set(), enemies: new Set() });
  world.players.set(ffIntruder, { id: ffIntruder, handle: 'FF Burglar', current_zone: unit });
  try {
    emit('breakin.attempt', { intruderId: ffIntruder, entranceZoneId: '__burg_ff_hall__', unitZoneIds: [unit], method: 'hack' });
    const blocked = await fireHook('forcefield.gate', { zoneId: unit });
    check('forcefield gate blocks under an active break-in', typeof blocked === 'string', `reason=${blocked}`);
    const clear = await fireHook('forcefield.gate', { zoneId: '__burg_ff_untouched__' });
    check('forcefield gate stays open for an untouched zone', clear === undefined, `reason=${clear}`);
  } finally {
    world.players.delete(ffIntruder);
    if (hadUnit) world.zones.set(unit, hadUnit); else world.zones.delete(unit);
  }
}
