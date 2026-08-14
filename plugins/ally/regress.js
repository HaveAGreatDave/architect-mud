// Ally plugin regression suite — run by tests/regress.js (never in production).
//
// Two things are under test and they are not the same thing.
//
// 1. The ENGINE seam (`npcAttackEnemy`): that an NPC's blow goes through the same
//    typed soak, the same body-part roll and the same damage observers a player's
//    blow does. The assertion that actually proves this is the soak one — a
//    version of the function built off `npcAttackNpc` (NPCs have no armour) would
//    pass every other check here and silently let allies cut through carapace
//    that stops the player.
// 2. The PLUGIN policy: targeting, kill credit, the withdraw model, and that no
//    teardown path leaks a body still holding a target.
//
// Plus the negative half: ordinary NPC combat must be untouched, and the tick must
// cost nothing when nobody has an ally.
import { world } from '../../server/engine/world.js';
import { emit, on } from '../../server/engine/events.js';
import { npcAttackEnemy, typeEffectiveness } from '../../server/engine/combat.js';
import { enemyAttackNpc } from '../../server/engine/combat.js';
import { registerEnemyDamageObserver } from '../../server/engine/damage-events.js';
import { registerProtectionProvider } from '../../server/engine/protection.js';
import { commands, enlist, dismiss, allyOf, _test } from './index.js';
import { allowedTarget, pickTarget } from './targeting.js';
import { shouldWithdraw, withdraw } from './downed.js';

const noop = () => {};
const Z = 'zone_ally_test';
const HOME = 'zone_ally_test_home';
const NPC = 'npc_ally_test';

function mkZone(id) {
  return { id, name: id, exits: {}, npcs: new Set(), enemies: new Set(), players: new Set(), flags: {} };
}

let seq = 0;
function mkEnemy(over = {}) {
  const instanceId = `ally_test_enemy_${++seq}`;
  const e = {
    instanceId, id: 'enemy_ally_test', name: 'test roach',
    zoneId: Z, hp: 200, hp_max: 200, dodge: -99,   // -99 so the swing always lands
    hit: 1, loot_table: [], flags: {},
    // ONE part, weight 100, so the part roll is deterministic and the soak
    // comparison below is a comparison of soak rather than of a head-multiplier
    // coin flip. hit 99 vs dodge -99 also puts every swing over the crit
    // threshold, which pins the damage number exactly.
    body_parts: [{ part: 'torso', weight: 100, soak: {} }],
    ...over,
  };
  world.enemies.set(instanceId, e);
  world.zones.get(Z)?.enemies.add(instanceId);
  return e;
}
function dropEnemy(e) {
  world.enemies.delete(e.instanceId);
  world.zones.get(Z)?.enemies.delete(e.instanceId);
}

// npcAttackEnemy shares the `_lastAttack` cooldown with the gameLoop retaliation
// loop — deliberately, so an ally can't hit a player and an enemy in one beat.
// Every test that wants a swing to land has to clear it first.
function readyToSwing(npc) { npc._lastAttack = 0; }

export default async function regress({ check, getPlayer }) {
  const player = getPlayer();
  const savedZone = player.current_zone;
  const savedKills = player.mob_kills;

  world.zones.set(Z, mkZone(Z));
  world.zones.set(HOME, mkZone(HOME));
  const npc = {
    id: NPC, name: 'Test Ally', zone_id: Z, home_zone: HOME,
    hp: 50, hp_max: 50,
    flags: { fights_for_you: true, hit: 99, dodge: 3, weapon: [{ type: 'kinetic', min: 5, max: 5 }] },
  };
  world.npcs.set(NPC, npc);
  world.zones.get(Z).npcs.add(NPC);
  player.current_zone = Z;
  world.zones.get(Z).players.add(player.id);

  try {
    // ── 1. The swing lands and moves HP ─────────────────────────────────────
    let e = mkEnemy();
    readyToSwing(npc);
    let res = await npcAttackEnemy(npc, e);
    check('npcAttackEnemy damages an enemy', res?.hit === true && e.hp < 200, JSON.stringify({ hp: e.hp, res: res?.hit }));
    const unsoakedDamage = res?.damage ?? 0;

    // ── 2. TYPED SOAK — the load-bearing assertion ──────────────────────────
    // Same NPC, same weapon, same part, against a creature whose every part
    // soaks 3 kinetic. If this ever reads "equal", somebody rebuilt the defender
    // side off npcAttackNpc and allies now ignore armour.
    const armoured = mkEnemy({
      body_parts: [{ part: 'torso', weight: 100, soak: { kinetic: 3 } }],
    });
    readyToSwing(npc);
    const soakedRes = await npcAttackEnemy(npc, armoured);
    check('an ally blow is reduced by the enemy\'s typed soak',
      (soakedRes?.damage ?? 99) < unsoakedDamage, `${soakedRes?.damage} vs ${unsoakedDamage}`);
    check('a fully-soaked ally blow still does at least 1', (soakedRes?.damage ?? 0) >= 1, String(soakedRes?.damage));

    // ── 3. Damage observers fire, tagged as an NPC blow ─────────────────────
    let seen = null;
    registerEnemyDamageObserver((_enemy, hit) => { if (hit?.source === 'npc') seen = hit; }, 'ally-regress');
    readyToSwing(npc);
    await npcAttackEnemy(npc, e, { credit: player });
    check('an ally blow fires the enemy damage observers with source:npc', seen?.source === 'npc', JSON.stringify(seen && { s: seen.source }));
    check('the observer payload credits the player, not the npc', seen?.attacker?.id === player.id, String(seen?.attacker?.id));
    check('the observer payload carries `via` (who actually swung)', seen?.via?.id === NPC, String(seen?.via?.id));

    // ── 4. Cooldown ─────────────────────────────────────────────────────────
    // No readyToSwing() — the previous swing set _lastAttack a moment ago.
    check('a second ally swing inside the interval returns null', (await npcAttackEnemy(npc, e)) === null);

    // ── 5 + 6. Kill: shape, removal, credit ─────────────────────────────────
    const doomed = mkEnemy({ hp: 1, butcher_table: [{ item: 'x' }], butcher_difficulty: 7 });
    player.mob_kills = 0;
    readyToSwing(npc);
    const kill = await npcAttackEnemy(npc, doomed, { credit: player });
    check('an ally kill returns the killed-result shape the corpse pipeline wants',
      kill?.killed === true && kill.enemyId === doomed.instanceId
      && Array.isArray(kill.loot) && kill.butcher_difficulty === 7,
      JSON.stringify({ k: kill?.killed, b: kill?.butcher_difficulty }));
    check('an ally kill removes the enemy instance', !world.enemies.has(doomed.instanceId));
    check('credit bumps the credited player\'s mob_kills by exactly one', player.mob_kills === 1, String(player.mob_kills));
    check('an ally kill clears the ally\'s stale target id', npc._combatTargetId == null, String(npc._combatTargetId));

    // Uncredited kill: nobody scores, nothing throws. (An ally can outlive the
    // player who hired them by a tick.)
    const orphan = mkEnemy({ hp: 1 });
    player.mob_kills = 5;
    readyToSwing(npc);
    const orphanKill = await npcAttackEnemy(npc, orphan);
    check('an uncredited ally kill scores for nobody and does not throw',
      orphanKill?.killed === true && player.mob_kills === 5, String(player.mob_kills));

    // ── 7. Quest credit survives an ally kill ───────────────────────────────
    // The single most likely bug in the feature is the ally silently stealing the
    // player's own kill objectives, so the emit shape is asserted directly.
    let killEvent = null;
    on('enemy.killed', (p) => { if (p?.via) killEvent = p; });
    const questMob = mkEnemy({ hp: 1, name: 'sewer roach' });
    readyToSwing(npc);
    enlist(player, npc);
    npc._combatTargetId = questMob.instanceId;
    readyToSwing(npc);
    await _test.allyTick();
    await new Promise(r => setTimeout(r, 30));
    check('an ally kill emits enemy.killed with the PLAYER as actor',
      killEvent?.actor?.id === player.id, String(killEvent?.actor?.id));
    check('an ally kill emits enemy.killed with `via` naming the ally',
      killEvent?.via?.id === NPC, String(killEvent?.via?.id));
    dismiss(NPC, 'dismissed');

    // ── 8. Forcefield ───────────────────────────────────────────────────────
    // Protection is provider-based, not a zone flag — register one for this zone
    // only, so the real getZoneProtection path is what's being exercised.
    let shielded = true;
    registerProtectionProvider((zoneId) => (shielded && zoneId === Z ? { owner: 'ally-regress' } : null), 'ally-regress');
    readyToSwing(npc);
    check('a quantum forcefield stops an ally swing too', (await npcAttackEnemy(npc, e)) === null);
    shielded = false;   // providers can't be unregistered; this one answers null forever after

    // ── Chemical is a SPECIALIST type ───────────────────────────────────────
    //
    // It arrived with pest control, and its whole design is that it is devastating
    // to vermin and feeble against everything else — which is what leaves room for
    // a later broad-spectrum agent to be a real escalation rather than a bigger
    // number. Asserted through npcAttackEnemy because that path is deterministic
    // here (hit 99 vs dodge -99 always crits; one body part; fixed 5-5 roll).
    {
      const chemNpc = { ...npc, flags: { ...npc.flags, weapon: [{ type: 'chemical', min: 5, max: 5 }] } };
      const bug = mkEnemy({ flags: { vermin: true } });
      const notBug = mkEnemy({ flags: {} });
      readyToSwing(chemNpc);
      const vsBug = await npcAttackEnemy(chemNpc, bug);
      readyToSwing(chemNpc);
      const vsOther = await npcAttackEnemy(chemNpc, notBug);
      check('chemical lands in full on something flagged vermin',
        vsBug?.damage === unsoakedDamage, `${vsBug?.damage} vs ${unsoakedDamage}`);
      check('chemical is heavily reduced against anything else',
        (vsOther?.damage ?? 99) < (vsBug?.damage ?? 0), `${vsOther?.damage} vs ${vsBug?.damage}`);
      check('a resisted chemical blow still does at least 1', (vsOther?.damage ?? 0) >= 1, String(vsOther?.damage));

      // The negative half, and the one that matters most: the vermin flag must
      // be invisible to every other damage type. If this ever fails, somebody
      // applied the multiplier unconditionally and quietly rebalanced the game.
      readyToSwing(npc);
      const kineticVsBug = await npcAttackEnemy(npc, bug);
      check('the vermin flag does NOT change kinetic damage',
        kineticVsBug?.damage === unsoakedDamage, `${kineticVsBug?.damage} vs ${unsoakedDamage}`);

      // Players are never vermin, so an NPC with a sprayer is not lethal to
      // someone who owns no chemical armour and has nowhere to buy any.
      check('typeEffectiveness treats a player as non-vermin',
        typeEffectiveness(player, 'chemical') < 1 && typeEffectiveness(player, 'kinetic') === 1);
      dropEnemy(bug); dropEnemy(notBug);
    }

    // ── 12. Targeting policy ────────────────────────────────────────────────
    npc.flags.ally_targets = ['enemy_ally_test'];
    check('targeting accepts a listed template', allowedTarget(npc, e) === true);
    check('targeting rejects an unlisted template', allowedTarget(npc, { ...e, id: 'enemy_something_else' }) === false);
    delete npc.flags.ally_targets;
    check('targeting with no list accepts anything hostile', allowedTarget(npc, e) === true);
    const weak = mkEnemy({ hp: 3 });
    const strong = mkEnemy({ hp: 150 });
    check('targeting prefers the weakest when nothing is on the player',
      pickTarget(npc, player, [strong, weak])?.instanceId === weak.instanceId);
    strong.targetId = player.id;
    check('targeting prefers whatever is already fighting the player',
      pickTarget(npc, player, [strong, weak])?.instanceId === strong.instanceId);
    dropEnemy(weak); dropEnemy(strong);

    // ── 9. Withdraw ─────────────────────────────────────────────────────────
    const hunter = mkEnemy();
    hunter.targetId = NPC;
    npc.zone_id = Z;
    npc.hp = 10;   // 20% of 50, below the default 30
    npc._combatTargetId = hunter.instanceId;
    check('shouldWithdraw fires below the threshold', shouldWithdraw(npc) === true);
    withdraw(npc);
    check('withdrawing clears the ally\'s target', npc._combatTargetId === null);
    check('withdrawing sheds anything holding the ally as ITS target', hunter.targetId === null);
    check('withdrawing walks the ally home', npc.zone_id === HOME, String(npc.zone_id));
    check('withdrawing does NOT kill the ally', !npc._dead);
    check('withdrawing stamps a re-enlist cooldown', npc._allyCooldownUntil > Date.now());
    check('an ally on cooldown refuses to be re-enlisted', enlist(player, npc).ok === false);
    dropEnemy(hunter);

    // ── 10. Withdraw is not immortality ─────────────────────────────────────
    // The whole model is a narrower window, not a shield. Get him killed and he
    // dies, through the ordinary engine path nobody here modified.
    npc._allyCooldownUntil = 0;
    npc.zone_id = Z;
    npc.hp = npc.hp_max;
    // `weapon` is a TOP-LEVEL array on an enemy (enemyWeaponComponents), not a flag.
    const killer = mkEnemy({ hit: 99, weapon: [{ type: 'kinetic', min: 500, max: 500 }], lastAttack: 0 });
    await enemyAttackNpc(killer, npc);
    check('an ally taking a lethal burst still dies', npc._dead === true && npc.hp === 0, `${npc._dead}/${npc.hp}`);

    // ── 14. Ordinary NPC combat is untouched ────────────────────────────────
    // The withdraw model must not have leaked into the general NPC path: a
    // bystander with no ally flags still dies outright with the engine's respawn.
    const bystander = { id: 'npc_ally_test_bystander', name: 'Bystander', zone_id: Z, hp: 5, hp_max: 5, flags: {} };
    world.npcs.set(bystander.id, bystander);
    world.zones.get(Z).npcs.add(bystander.id);
    killer.lastAttack = 0;
    await enemyAttackNpc(killer, bystander);
    check('a non-allied NPC still dies outright with a respawn scheduled',
      bystander._dead === true && bystander._respawnAt > Date.now(), `${bystander._dead}/${bystander._respawnAt}`);
    world.npcs.delete(bystander.id);
    dropEnemy(killer);

    // ── 11. Teardown leaks nothing ──────────────────────────────────────────
    npc._dead = false; npc.hp = npc.hp_max; npc.zone_id = Z; npc._allyCooldownUntil = 0;
    world.zones.get(HOME).npcs.delete(NPC);
    world.zones.get(Z).npcs.add(NPC);   // withdrawing moved the body; put it back
    let r = commands.ally(['test'], 'test', player, noop);
    check('ally <name> enlists a willing NPC', allyOf(player.id)?.id === NPC, String(r?.message));
    npc._combatTargetId = 'stale_instance';
    emit('player.logout', { id: player.id });
    await new Promise(r2 => setTimeout(r2, 30));
    check('logging out ends the arrangement', !allyOf(player.id));
    check('teardown clears the ally\'s combat target', npc._combatTargetId === null, String(npc._combatTargetId));
    check('no ally state is leaked behind', _test.byNpc.size === 0 && _test.byPlayer.size === 0,
      `${_test.byNpc.size}/${_test.byPlayer.size}`);

    // Consent: the verb refuses an NPC that never agreed to fight for anyone.
    // Without this, `ally <any shopkeeper>` is a free bodyguard button.
    npc.flags.fights_for_you = false;
    r = commands.ally(['test'], 'test', player, noop);
    check('ally refuses an NPC without flags.fights_for_you', !allyOf(player.id), String(r?.message));
    npc.flags.fights_for_you = true;

    // Killing the ally ends it too.
    commands.ally(['test'], 'test', player, noop);
    emit('npc.killed', { actor: player, npc });
    await new Promise(r2 => setTimeout(r2, 30));
    check('killing the ally ends the arrangement', !allyOf(player.id) && _test.byNpc.size === 0);

    // ── 15. The tick is inert with no allies ────────────────────────────────
    // A per-second tick that walks the world for a game with no allies in it is a
    // hosting bill, not a test failure — so it must return before it touches
    // anything. Asserted by monkeypatching the zone lookup it would reach for.
    const zone = world.zones.get(Z);
    let touched = 0;
    const realEnemies = zone.enemies;
    Object.defineProperty(zone, 'enemies', { get() { touched++; return realEnemies; }, configurable: true });
    await _test.allyTick();
    delete zone.enemies;
    zone.enemies = realEnemies;
    check('the ally tick touches nothing when nobody has an ally', touched === 0, String(touched));

    dropEnemy(e); dropEnemy(armoured);
  } finally {
    dismiss(NPC, 'dismissed');
    for (const id of [...world.enemies.keys()]) if (id.startsWith('ally_test_enemy_')) world.enemies.delete(id);
    world.npcs.delete(NPC);
    world.zones.delete(Z);
    world.zones.delete(HOME);
    player.current_zone = savedZone;
    player.mob_kills = savedKills;
  }
}
