// Escort plugin regression suite — run by tests/regress.js (never in production).
//
// Builds two synthetic adjacent zones and one synthetic NPC so the walk can be
// driven end-to-end through the real seams: the zone.entered subscriber, the real
// moveEntity, and the real teardown paths. What's actually being guarded here is
// that the escortee is a live body and not a token — it can be left behind, it can
// be killed, and either way the escort ends cleanly instead of leaking a frozen
// NPC (`_escorting` un-cleared) that never ticks its AI again.
import { world } from '../../server/engine/world.js';
import { emit } from '../../server/engine/events.js';
import { commands, startEscort, endEscort, escorteeOf, _test } from './index.js';

const noop = () => {};
const A = 'zone_escort_test_a';
const B = 'zone_escort_test_b';
const NPC = 'npc_escort_test';

function mkZone(id, exits) {
  return { id, name: id, exits, npcs: new Set(), enemies: new Set(), players: new Set(), flags: {} };
}

export default async function regress({ check, getPlayer }) {
  const player = getPlayer();
  const savedZone = player.current_zone;

  world.zones.set(A, mkZone(A, [{ dir: 'north', target: B }]));
  world.zones.set(B, mkZone(B, [{ dir: 'south', target: A }]));
  const npc = { id: NPC, name: 'Test Escortee', zone_id: A, flags: { escortable: true } };
  world.npcs.set(NPC, npc);
  world.zones.get(A).npcs.add(NPC);
  player.current_zone = A;

  try {
    // ── Consent: the verb refuses an NPC that hasn't agreed to go anywhere ──
    // Without this the verb is a "make any NPC follow me" button, and every
    // shopkeeper in Coldwater can be walked off their counter.
    npc.flags.escortable = false;
    let r = commands.escort(['test'], 'test', player, noop);
    check('escort refuses an NPC without flags.escortable', !escorteeOf(player.id), String(r?.message));
    npc.flags.escortable = true;

    // ── Start ──
    r = commands.escort(['test'], 'test', player, noop);
    check('escort <name> starts the escort', escorteeOf(player.id)?.id === NPC, String(r?.message));
    check('an escortee is frozen from the AI tick', npc._escorting === player.id, String(npc._escorting));

    // One at a time, in both directions.
    check('a second escort is refused while one is running',
      startEscort(player, npc).ok === false);

    // ── The walk: the escortee follows the player's step ──
    let arrived = null;
    const offArrived = (p) => { arrived = p; };
    // emit is fire-and-forget; subscribe inline and read after.
    const { on } = await import('../../server/engine/events.js');
    on('escort.arrived', offArrived);

    player.current_zone = B;
    world.zones.get(A).players.delete(player.id);
    world.zones.get(B).players.add(player.id);
    emit('zone.entered', { actor: player, zone: B, from: A });
    await new Promise(r2 => setTimeout(r2, 30));

    check('the escortee walks into the zone the player entered', npc.zone_id === B, String(npc.zone_id));
    check('escort.arrived fires with the npc and the zone',
      arrived?.npc?.id === NPC && arrived?.zone === B, JSON.stringify({ n: arrived?.npc?.id, z: arrived?.zone }));

    // ── Separation: never teleport ──
    // The escortee left standing somewhere else must stay there. Teleporting it to
    // the player would make locked doors, elevators and the void meaningless.
    npc.zone_id = 'zone_escort_test_elsewhere';
    player.current_zone = A;
    emit('zone.entered', { actor: player, zone: A, from: B });
    await new Promise(r2 => setTimeout(r2, 30));
    check('a separated escortee is never teleported to the player',
      npc.zone_id === 'zone_escort_test_elsewhere', String(npc.zone_id));

    // ── Death ends it, and un-freezes the body ──
    emit('npc.killed', { actor: player, npc });
    await new Promise(r2 => setTimeout(r2, 30));
    check('killing the escortee ends the escort', !escorteeOf(player.id));
    check('ending an escort clears the AI freeze', npc._escorting === undefined, String(npc._escorting));
    check('no escort state is leaked behind', _test.byNpc.size === 0 && _test.byPlayer.size === 0,
      `${_test.byNpc.size}/${_test.byPlayer.size}`);

    // ── Dismissal ──
    npc._dead = false;
    npc.zone_id = A;
    player.current_zone = A;
    commands.escort(['test'], 'test', player, noop);
    commands.escort(['stop'], 'stop', player, noop);
    check('escort stop dismisses the escortee', !escorteeOf(player.id) && npc._escorting === undefined);

    // endEscort on an NPC nobody is escorting is a silent no-op — every teardown
    // path calls it unconditionally.
    check('endEscort is a no-op for an unescorted NPC', endEscort(NPC) === false);
  } finally {
    endEscort(NPC, 'dismissed');
    world.npcs.delete(NPC);
    world.zones.delete(A);
    world.zones.delete(B);
    player.current_zone = savedZone;
  }
}
