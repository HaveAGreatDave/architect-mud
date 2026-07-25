// Weapon plugin regression — the admin `kamehameha` verb's routing + role gate,
// plus the combat-upgrade surface: stances, the pow/dodge moves, and the
// contested-flee move gate.
// (The core attack/kill/corpse mechanics are exercised by the main dispatch suite
// in tests/regress.js; this guards the verbs this plugin owns.)
import { getRegisteredMoveGates } from '../../server/engine/movement-gates.js';
import { getStance, swingInterval, STANCES, isDodging } from '../../server/engine/stance.js';
import { setCooldown, isOnCooldown, getCooldownRemaining, hasPowerQueued, toughestAttacker } from '../../server/engine/combat.js';
import { world, removeEnemyInstance } from '../../server/engine/world.js';

export default async function regress({ run, check, getPlayer }) {
  // Typed with the `@` admin sigil (stripped by the dispatcher). Non-admins get
  // the generic unknown-command reply — the verb stays hidden.
  const denied = await run('@kamehameha');
  check('kamehameha denied for non-admin', /Unknown command/.test(denied?.message || ''), denied?.message);

  // An admin passes the gate (the outcome is a blast or an empty-room notice,
  // never the unknown-command reply).
  const p = getPlayer();
  const prevRole = p.role;
  p.role = 'admin';
  const fired = await run('@kamehameha');
  check('@kamehameha runs for admin', !/Unknown command/.test(fired?.message || ''), fired?.message);
  p.role = prevRole;

  // seppuku is unrestricted (any player, any role) — not exercised end-to-end here
  // since firing it would run the fake test player through the real death/respawn
  // path and disturb every plugin suite that runs after this one in layer 3.

  // ── Stances ────────────────────────────────────────────────────────────────
  // Reset the ledger between assertions: cooldowns are process-global and the
  // suite would otherwise trip over its own 60s stance lock.
  const clearCd = (action) => setCooldown(p.id, action, 0);

  clearCd('stance');
  const cautious = await run('fight cau');           // prefix match
  check('fight sets stance by prefix', getStance(p) === 'cautious', `${getStance(p)} / ${cautious?.message}`);
  check('stance line carries player_update', cautious?.player_update?.combat_stance === 'cautious', JSON.stringify(cautious?.player_update));

  // The 60s lock applies to EVERY change, including back to normal.
  const locked = await run('fight normal');
  check('stance change locked by cooldown', locked?.type === 'error' && /locked into/i.test(locked.message || ''), locked?.message);
  check('stance unchanged while locked', getStance(p) === 'cautious', getStance(p));

  const bogus = await run('fight sideways');
  check('unknown stance rejected', bogus?.type === 'error' && /No such stance/.test(bogus.message || ''), bogus?.message);

  // Swing interval is the flat ms delta off the 3500 base, per stance.
  const expected = { berserk: 2500, aggressive: 3000, normal: 3500, cautious: 4000, pacifist: 4500 };
  let intervalsOk = true, intervalDetail = '';
  for (const [id, ms] of Object.entries(expected)) {
    p.combat_stance = id;
    if (swingInterval(p) !== ms) { intervalsOk = false; intervalDetail += `${id}=${swingInterval(p)}!=${ms} `; }
  }
  check('stance swing intervals', intervalsOk, intervalDetail);
  check('every stance has a modifier row', Object.keys(expected).every(id => STANCES[id]), Object.keys(STANCES).join(','));

  // ── pow / dodge ────────────────────────────────────────────────────────────
  p.combat_stance = 'pacifist';
  clearCd('combat_move'); clearCd('attack');
  const powPacifist = await run('pow');
  check('pow refused in pacifist', powPacifist?.type === 'error' && /pacifist/i.test(powPacifist.message || ''), powPacifist?.message);

  p.combat_stance = 'berserk';
  clearCd('combat_move'); clearCd('attack');
  const dodgeBerserk = await run('dodge');
  check('dodge refused in berserk', dodgeBerserk?.type === 'error' && /too far gone/i.test(dodgeBerserk.message || ''), dodgeBerserk?.message);

  // `pow` is a wind-up, NOT a swing: it must fire while the attack cooldown is
  // running (in sustained combat it almost always is — the gameLoop swings the
  // instant it lifts), and it RESETS the swing timer to 1.5x the stance interval.
  p.combat_stance = 'normal';
  p.combatTargetId = 'regress_fake_target';
  clearCd('combat_move');
  setCooldown(p.id, 'attack', 3000);            // mid-swing, as during auto-attack
  const powMid = await run('pow');
  check('pow works while the swing timer is running', powMid?.type === 'combat' && /wind up/i.test(powMid.message || ''), `${powMid?.type} ${powMid?.message}`);
  check('pow arms the one-shot flag', hasPowerQueued(p), 'flag not armed');
  // 3500 base × 1.5 = 5250, replacing the 3000 that was left — the timer reset,
  // it did not wait out the old one.
  const remaining = getCooldownRemaining(p.id, 'attack');
  check('pow resets the swing timer to the wind-up', remaining > 5000 && remaining <= 5250, `${remaining}ms`);

  p._powQueued = false;
  p.combatTargetId = null;
  clearCd('combat_move'); clearCd('attack');

  const powNoTarget = await run('pow');
  check('pow with no target is refused', powNoTarget?.type === 'error' && /Power attack what/.test(powNoTarget.message || ''), powNoTarget?.message);

  // The shared 10s window: dodge burns it, so pow can't follow.
  clearCd('combat_move'); clearCd('attack');
  const dodged = await run('dodge');
  check('dodge arms the window', dodged?.type === 'combat' && isDodging(p), `${dodged?.type} dodging=${isDodging(p)}`);
  check('dodge locks attacking', isOnCooldown(p.id, 'attack'), 'attack cooldown not set');
  const powAfterDodge = await run('pow');
  check('pow shares the dodge cooldown', powAfterDodge?.type === 'error' && /not set for it yet/i.test(powAfterDodge.message || ''), powAfterDodge?.message);
  const dodgeAgain = await run('dodge');
  check('dodge cannot be re-armed inside the window', dodgeAgain?.type === 'error', dodgeAgain?.message);

  p._dodgeUntil = 0;
  clearCd('combat_move'); clearCd('attack');

  // ── Contested flee ─────────────────────────────────────────────────────────
  check('flee move gate registered', getRegisteredMoveGates().includes('weapon:flee'), getRegisteredMoveGates().join(','));

  // Nobody attacking → no attacker, so movement stays free.
  p._fleeIntent = null;
  check('no attacker means free movement', toughestAttacker(p) === null, JSON.stringify(toughestAttacker(p)));

  // Plant an enemy that has locked onto us; the gate must now see an attacker.
  const instanceId = `regress_flee_${process.pid}`;
  let planted = false;
  try {
    // No public spawn-by-hand API (spawnEnemySync needs a real template row), so
    // the instance goes straight into the world maps — the same two structures
    // spawnEnemySync writes. removeEnemyInstance tears both down.
    world.enemies.set(instanceId, {
      instanceId,
      templateId: 'regress_flee_mob',
      name: 'a regression dummy',
      zoneId: p.current_zone,
      hp: 10, hp_max: 10, hit: 3, dodge: 1,
      targetId: p.id,
      lastAttack: Date.now(),
      behavior: 'passive',
    });
    world.zones.get(p.current_zone)?.enemies.add(instanceId);
    planted = true;
    const attacker = toughestAttacker(p);
    check('an enemy targeting you is an attacker', attacker?.hit === 3, JSON.stringify(attacker));

    // On attack cooldown, the gate defers: the move is blocked silently and an
    // intent is armed for the gameLoop to retry.
    setCooldown(p.id, 'attack', 60000);
    const zoneBefore = p.current_zone;
    await run('north');
    check('move blocked while under attack', p.current_zone === zoneBefore, `${zoneBefore} -> ${p.current_zone}`);
    check('flee intent armed', !!p._fleeIntent, JSON.stringify(p._fleeIntent));

    // `stop` abandons the attempt rather than leaving the loop retrying it.
    await run('stop');
    check('stop clears the flee intent', !p._fleeIntent, JSON.stringify(p._fleeIntent));
  } finally {
    if (planted) removeEnemyInstance(instanceId);
    p._fleeIntent = null;
    p.combat_stance = 'normal';
    clearCd('attack'); clearCd('combat_move'); clearCd('stance');
  }
}
