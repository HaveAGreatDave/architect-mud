import { getEnemyInstance, removeEnemyInstance, getLivePlayer, getZonePlayers } from './world.js';

const COOLDOWNS = {
  attack: 2000,
  flee: 3000,
  use_item: 1500,
};

const playerCooldowns = new Map(); // playerId -> { action -> timestamp }

export function isOnCooldown(playerId, action) {
  const cds = playerCooldowns.get(playerId) || {};
  const cd = COOLDOWNS[action] || 1000;
  return Date.now() - (cds[action] || 0) < cd;
}

export function setCooldown(playerId, action) {
  const cds = playerCooldowns.get(playerId) || {};
  cds[action] = Date.now();
  playerCooldowns.set(playerId, cds);
}

export function getCooldownRemaining(playerId, action) {
  const cds = playerCooldowns.get(playerId) || {};
  const cd = COOLDOWNS[action] || 1000;
  const elapsed = Date.now() - (cds[action] || 0);
  return Math.max(0, cd - elapsed);
}

// Roll attack: attacker stat vs defender. Returns { hit, damage, critical }
export function rollAttack(attacker, defender) {
  const hitRoll = Math.random() * 20 + attacker.stat_agi;
  const defRoll = Math.random() * 15 + (defender.stat_agi || 5);
  const hit = hitRoll > defRoll;
  if (!hit) return { hit: false, damage: 0, critical: false };

  const critical = Math.random() < 0.05 + (attacker.stat_str - 5) * 0.01;
  let damage = Math.floor(
    Math.random() * (attacker.damage_max - attacker.damage_min + 1) + attacker.damage_min
  );
  if (critical) damage = Math.floor(damage * 2);
  const armor = defender.armor || 0;
  damage = Math.max(1, damage - armor);

  return { hit: true, damage, critical };
}

// Player attacks enemy instance
export function playerAttackEnemy(player, enemyInstanceId, weaponStats) {
  if (isOnCooldown(player.id, 'attack')) {
    return { success: false, message: `You're still recovering. (${(getCooldownRemaining(player.id, 'attack') / 1000).toFixed(1)}s)` };
  }

  const enemy = getEnemyInstance(enemyInstanceId);
  if (!enemy) return { success: false, message: "That target is gone." };
  if (enemy.zoneId !== player.current_zone) return { success: false, message: "That target isn't here." };

  const attacker = {
    stat_agi: player.stat_agi,
    stat_str: player.stat_str,
    damage_min: weaponStats?.damage_min || 2,
    damage_max: weaponStats?.damage_max || 5,
  };

  const result = rollAttack(attacker, enemy);
  setCooldown(player.id, 'attack');

  if (!result.hit) {
    return {
      success: true,
      hit: false,
      message: `You swing at ${enemy.name} and miss. It doesn't look impressed.`,
      enemyId: enemyInstanceId,
      enemyHp: enemy.hp,
      enemyHpMax: enemy.hp_max,
    };
  }

  enemy.hp -= result.damage;
  enemy.targetId = player.id;

  if (enemy.hp <= 0) {
    const loot = resolveEnemyLoot(enemy);
    removeEnemyInstance(enemyInstanceId);
    return {
      success: true,
      hit: true,
      killed: true,
      critical: result.critical,
      damage: result.damage,
      message: result.critical
        ? `CRITICAL HIT! You deal ${result.damage} damage to ${enemy.name}. ${enemy.death_message}`
        : `You deal ${result.damage} damage to ${enemy.name}. ${enemy.death_message}`,
      loot,
      xp_reward: enemy.xp_reward,
      credit_reward: enemy.credit_reward,
      enemyId: enemyInstanceId,
    };
  }

  return {
    success: true,
    hit: true,
    killed: false,
    critical: result.critical,
    damage: result.damage,
    message: result.critical
      ? `CRITICAL HIT! You deal ${result.damage} damage to ${enemy.name}! (${enemy.hp}/${enemy.hp_max} HP remaining)`
      : `You deal ${result.damage} damage to ${enemy.name}. (${enemy.hp}/${enemy.hp_max} HP remaining)`,
    enemyId: enemyInstanceId,
    enemyHp: enemy.hp,
    enemyHpMax: enemy.hp_max,
  };
}

// Enemy attacks player — returns damage result
export function enemyAttackPlayer(enemy, player) {
  const now = Date.now();
  const attackInterval = 3000 - (enemy.stat_agi * 100);
  if (now - enemy.lastAttack < attackInterval) return null;
  enemy.lastAttack = now;

  const attacker = {
    stat_agi: enemy.stat_agi,
    stat_str: enemy.stat_str,
    damage_min: enemy.damage_min,
    damage_max: enemy.damage_max,
  };

  const defender = {
    stat_agi: player.stat_agi,
    armor: player.armor || 0,
  };

  const result = rollAttack(attacker, defender);
  if (!result.hit) {
    return { hit: false, message: `${enemy.name} attacks you and misses.` };
  }

  return {
    hit: true,
    damage: result.damage,
    critical: result.critical,
    message: result.critical
      ? `CRITICAL! ${enemy.name} hits you for ${result.damage} damage!`
      : `${enemy.name} hits you for ${result.damage} damage.`,
  };
}

function resolveEnemyLoot(enemy) {
  const drops = [];
  for (const entry of enemy.loot_table) {
    if (Math.random() * 100 < entry.weight) {
      const qty = Array.isArray(entry.qty)
        ? Math.floor(Math.random() * (entry.qty[1] - entry.qty[0] + 1)) + entry.qty[0]
        : 1;
      drops.push({ item_id: entry.item, quantity: qty });
    }
  }
  return drops;
}

// Status effect tick — called each second for players in combat
export function tickStatuses(player) {
  const messages = [];
  if (!player.statuses) return messages;

  player.statuses = player.statuses.filter(s => {
    if (s.name === 'bleeding') {
      player.hp = Math.max(0, player.hp - 2);
      messages.push('You are bleeding. (-2 HP)');
    }
    if (s.name === 'burning') {
      player.hp = Math.max(0, player.hp - 5);
      messages.push('You are on fire. (-5 HP)');
    }
    if (s.name === 'irradiated') {
      player.radiation = Math.min(100, (player.radiation || 0) + 2);
      messages.push('Radiation courses through you. (+2 RAD)');
    }
    s.duration--;
    return s.duration > 0;
  });

  return messages;
}
