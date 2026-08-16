// Weapon plugin regression — the admin `kamehameha` verb's routing + role gate,
// plus the combat-upgrade surface: stances, the pow/dodge moves, and the
// contested-flee move gate.
// (The core attack/kill/corpse mechanics are exercised by the main dispatch suite
// in tests/regress.js; this guards the verbs this plugin owns.)
import { getRegisteredMoveGates } from '../../server/engine/movement-gates.js';
import { getStance, swingInterval, STANCES, isDodging } from '../../server/engine/stance.js';
import { setCooldown, isOnCooldown, getCooldownRemaining, hasPowerQueued, toughestAttacker, applyStrikeToEnemy } from '../../server/engine/combat.js';
import { applyEffect, tickMobEffects, mobStatusLabels, mobSupportsEffect } from '../../server/engine/effects.js';
import { world, removeEnemyInstance, getZone } from '../../server/engine/world.js';
import { query } from '../../server/models/db.js';

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
    //
    // The direction must be a REAL exit of whatever zone the harness picked — it
    // only guarantees *some* passable exit, not a northerly one. Hardcoding
    // `north` made this fixture pass or fail on world content: a zone without one
    // rejects the move before any move gate is consulted, which left the block
    // check passing for the wrong reason and the intent check failing.
    setCooldown(p.id, 'attack', 60000);
    const zoneBefore = p.current_zone;
    const dir = Object.keys(getZone(zoneBefore)?.exits || {})[0];
    check('the harness zone has an exit to flee toward', !!dir, `${zoneBefore} exits: ${JSON.stringify(getZone(zoneBefore)?.exits)}`);
    await run(dir);
    check('move blocked while under attack', p.current_zone === zoneBefore, `${zoneBefore} -(${dir})-> ${p.current_zone}`);
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

  // ── Status effects on a mob ────────────────────────────────────────────────
  // A weapon's `status_chance` reached players only until now: `burning` on a
  // rust hound sat in its status list doing nothing. These guard the seam that
  // opened it — the registry's opt-in, the intent shape, and the fact that a mob
  // still refuses every player-only effect.
  {
    const mobId = `regress_burn_${process.pid}`;
    let mobPlanted = false;
    try {
      // Only two effects have declared themselves mob-capable. Anything else must
      // stay refused, or we are back to statuses that count down and do nothing.
      check('burning is mob-capable', mobSupportsEffect('burning'));
      check('bleeding is mob-capable', mobSupportsEffect('bleeding'));
      check('food_poisoning is NOT mob-capable', !mobSupportsEffect('food_poisoning'));
      check('rested is NOT mob-capable', !mobSupportsEffect('rested'));

      world.enemies.set(mobId, {
        instanceId: mobId,
        templateId: 'regress_burn_mob',
        name: 'a smouldering dummy',
        zoneId: p.current_zone,
        hp: 40, hp_max: 40, hit: 3, dodge: 1,
        body_parts: [], loot_table: [],
        statuses: [],
        behavior: 'passive',
      });
      world.zones.get(p.current_zone)?.enemies.add(mobId);
      mobPlanted = true;
      const mob = world.enemies.get(mobId);

      applyEffect(mob, 'burning', 5, { source: p.id });
      check('an enemy carries the effect', mob.statuses.some(s => s.name === 'burning'), JSON.stringify(mob.statuses));
      check('…and remembers who lit it', mob.statuses[0].source === p.id, mob.statuses[0].source);
      check('…and says so on the Hostiles line', mobStatusLabels(mob).includes('Burning'), JSON.stringify(mobStatusLabels(mob)));

      // The tick returns an INTENT and applies nothing itself — the whole reason
      // the split exists is that only applyStrikeToEnemy may move a mob's HP.
      const hpBefore = mob.hp;
      const [intent] = tickMobEffects(mob);
      check('the tick yields an intent', intent?.effect === 'burning', JSON.stringify(intent));
      check('…typed as fire, so soak applies', intent.damageType === 'fire', intent.damageType);
      check('…and applies no damage by itself', mob.hp === hpBefore, `${hpBefore} -> ${mob.hp}`);
      check('…the first beat is spoken', intent.speak === true);
      check('…and the duration burned down', mob.statuses[0].duration === 4, mob.statuses[0].duration);

      // Second beat is silent — the anti-spam cadence, which is the only thing
      // standing between a 20-second burn and 20 identical lines.
      const [second] = tickMobEffects(mob);
      check('the second beat is not spoken', second.speak === false);

      // …and the strike path is what actually hurts it.
      const struck = await applyStrikeToEnemy(p, mob, intent);
      check('the intent routed through the strike path lands', struck?.damage >= 1, JSON.stringify(struck));
      check('…and the mob is down that much HP', mob.hp === hpBefore - struck.damage, `${hpBefore} -> ${mob.hp}`);

      // A player-only effect must not stick to a mob even if something hands it
      // over directly — the guard lives in rollWeaponStatus, but the label pass
      // is the backstop that stops it ever being ADVERTISED.
      applyEffect(mob, 'food_poisoning', 5);
      check('a player-only effect is never shown on a mob', !mobStatusLabels(mob).includes('Food poisoning'), JSON.stringify(mobStatusLabels(mob)));
      check('…and is not ticked either', tickMobEffects(mob).every(i => i.effect !== 'food_poisoning'));

      // Expiry: an effect that has run out leaves the list rather than lingering.
      mob.statuses = [];
      applyEffect(mob, 'bleeding', 1);
      tickMobEffects(mob);
      check('an expired effect clears itself', !mob.statuses.some(s => s.name === 'bleeding'), JSON.stringify(mob.statuses));
    } finally {
      if (mobPlanted) removeEnemyInstance(mobId);
    }
  }

  // ── Ammunition & arc chain, as authored ────────────────────────────────────
  // Both are content-driven: the mechanism is generic and the only thing that
  // makes a weapon spend rounds or throw an arc is what the item file says. So
  // what is worth guarding is that the authored numbers are SANE — a typo here
  // is a weapon that fires forever, or one that arcs forever.
  {
    const { rows } = await query(
      `SELECT id, name, tags FROM items
        WHERE jsonb_exists(tags,'ammo_capacity') OR jsonb_exists(tags,'arc_chain') OR jsonb_exists(tags,'ammo_load')`);

    const guns = rows.filter(r => r.tags?.ammo_capacity != null);
    const loads = rows.filter(r => r.tags?.ammo_load != null);
    check('at least one weapon takes ammunition', guns.length > 0, `${rows.length} rows`);

    for (const g of guns) {
      const t = g.tags;
      check(`${g.id}: capacity is a positive number`, Number(t.ammo_capacity) > 0, t.ammo_capacity);
      // The live count is per-unit instance state, so two of them in one stack
      // would share a magazine and one would be silently refilled or emptied.
      check(`${g.id}: is unique, or two of them share a magazine`, t.unique === true, JSON.stringify(t.unique));
      // A weapon with no ammo_type can be fired dry and never refilled. That is a
      // legitimate choice for something disposable — but nothing authored today
      // means it, so an absent type is far likelier to be an omission.
      check(`${g.id}: declares what it eats`, typeof t.ammo_type === 'string' && t.ammo_type.length > 0, t.ammo_type);
      // …and something in the world must actually fit it, or the weapon is a
      // one-magazine weapon that reads like a reloadable one.
      check(`${g.id}: something in the world fits it`,
        loads.some(l => l.tags.ammo_load?.type === t.ammo_type),
        `${t.ammo_type} vs ${loads.map(l => l.tags.ammo_load?.type).join(',')}`);
    }

    for (const l of loads) {
      check(`${l.id}: load declares a type`, typeof l.tags.ammo_load?.type === 'string', JSON.stringify(l.tags.ammo_load));
      check(`${l.id}: load carries a positive number of units`, Number(l.tags.ammo_load?.units) > 0, JSON.stringify(l.tags.ammo_load));
    }

    for (const a of rows.filter(r => r.tags?.arc_chain != null)) {
      const arc = a.tags.arc_chain;
      check(`${a.id}: arc declares jumps`, Number(arc?.jumps) >= 1, JSON.stringify(arc));
      // Below 1 or the chain amplifies — every jump at least as hard as the last,
      // which is a room-clearing weapon rather than an arc. The engine clamps it
      // anyway; this catches the authoring mistake where it was clamped.
      check(`${a.id}: arc falls off rather than amplifying`, Number(arc?.falloff) > 0 && Number(arc?.falloff) < 1, JSON.stringify(arc));
      // An arc carrying status_chance would stun a whole room off one swing.
      check(`${a.id}: an arc weapon does not also apply statuses`, a.tags.status_chance == null, JSON.stringify(a.tags.status_chance));
    }
  }
}
