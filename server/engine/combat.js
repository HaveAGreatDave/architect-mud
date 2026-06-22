import { getEnemyInstance, removeEnemyInstance, getLivePlayer, getZonePlayers } from './world.js';
import { effectiveSkill } from './skills.js';
import { ensureTunables, getTunable } from './tunables.js';

const COOLDOWNS = {
  attack: 3500,
  flee: 4000,
  use_item: 2500,
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

function roll2d8() {
  return Math.floor(Math.random() * 8) + 1 + Math.floor(Math.random() * 8) + 1;
}

// Symmetric comparison swing: 2d8 − 2d8, range −14..+14. ~40% of rolls land
// within ±2, so close hit-vs-dodge matchups are coin-flippy and big gaps decide.
function rollSwing() {
  return roll2d8() - roll2d8();
}

function randInt(min, max) {
  const lo = Math.min(min, max), hi = Math.max(min, max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

const DEFAULT_BODY_PART_WEIGHTS = { head:10, torso:40, left_arm:12, right_arm:12, left_leg:13, right_leg:13 };

// Which equip slot covers each struck body part. Arms share the hands piece,
// legs share the legs piece; feet has no dedicated body part in the weight table.
const PART_TO_SLOT = {
  head: 'head', torso: 'torso',
  left_arm: 'hands', right_arm: 'hands',
  left_leg: 'legs', right_leg: 'legs',
};

const PART_LABELS = {
  head: 'head', torso: 'torso',
  left_arm: 'left arm', right_arm: 'right arm',
  left_leg: 'left leg', right_leg: 'right leg',
};

// Weighted pick of a struck body part. Pass explicit weights (e.g. a monster's
// per-part hit %) or fall back to the global tunable default (~torso-heavy).
function rollBodyPart(customWeights) {
  const weights = customWeights || getTunable('body_part_weights', DEFAULT_BODY_PART_WEIGHTS);
  const parts = Object.keys(weights);
  const total = parts.reduce((s, p) => s + (weights[p] || 0), 0);
  let roll = Math.random() * total;
  for (const p of parts) {
    roll -= weights[p] || 0;
    if (roll < 0) return p;
  }
  return parts[parts.length - 1] || 'torso';
}

// Reduce a typed-soak map against a damage type. Matched type → full value;
// no entry for that type → minimal reduction (best other value * mismatch factor).
function resolveSoak(soakMap, damageType) {
  if (!soakMap || typeof soakMap !== 'object') return 0;
  if (damageType in soakMap) return Number(soakMap[damageType]) || 0;
  const values = Object.values(soakMap).map(Number).filter(v => !isNaN(v));
  if (!values.length) return 0;
  const factor = getTunable('soak_mismatch_factor', 0.25);
  return Math.floor(Math.max(...values) * factor);
}

// Total soak for a player on the struck part: typed armor_soak + legacy flat.
function playerPartSoak(player, part, damageType) {
  const entry = player.soak?.[PART_TO_SLOT[part]];
  if (!entry) return 0;
  return resolveSoak(entry.soak, damageType) + (entry.flat || 0);
}

// Total soak for an enemy: typed soak map if present, else flat armor fallback.
// Used only as the legacy fallback for enemies with no per-part body_parts.
function enemySoak(enemy, damageType) {
  if (enemy.soak && Object.keys(enemy.soak).length) return resolveSoak(enemy.soak, damageType);
  return enemy.armor || 0;
}

// Per-part hit weights from a monster's body_parts (array of {part,weight,soak}).
// Returns null when the monster has none, so the caller uses the global default.
function enemyBodyPartWeights(enemy) {
  const parts = enemy.body_parts;
  if (Array.isArray(parts) && parts.length) {
    const w = {};
    for (const p of parts) if (p && p.part) w[p.part] = Number(p.weight) || 0;
    return w;
  }
  return null;
}

// Soak for the struck part of a monster, from its body_parts typed soak map.
// Falls back to the legacy single soak/armor for monsters with no body_parts.
function enemyPartSoak(enemy, part, damageType) {
  const parts = enemy.body_parts;
  if (Array.isArray(parts) && parts.length) {
    const entry = parts.find(p => p && p.part === part);
    return entry ? resolveSoak(entry.soak, damageType) : 0;
  }
  return enemySoak(enemy, damageType);
}

// A monster's attack as a list of typed damage components ({type,min,max}).
// Falls back to a single component from the legacy damage_min/max columns.
function enemyWeaponComponents(enemy) {
  if (Array.isArray(enemy.weapon) && enemy.weapon.length) {
    return enemy.weapon.map(c => ({
      type: c.type || 'kinetic',
      min: Number(c.min) || 0,
      max: Number(c.max) || 0,
    }));
  }
  return [{ type: enemy.flags?.damage_type || 'kinetic', min: enemy.damage_min || 2, max: enemy.damage_max || 5 }];
}

// Player attacks enemy instance. Returns { success, hit, killed, damage, critical, margin, ... }
export async function playerAttackEnemy(player, enemyInstanceId, weaponStats) {
  if (isOnCooldown(player.id, 'attack')) {
    return { success: false, message: `You're still recovering. (${(getCooldownRemaining(player.id, 'attack') / 1000).toFixed(1)}s)` };
  }

  const enemy = getEnemyInstance(enemyInstanceId);
  if (!enemy) return { success: false, message: "That target is gone." };
  if (enemy.zoneId !== player.current_zone) return { success: false, message: "That target isn't here." };

  await ensureTunables();

  const weaponSkillId = weaponStats?.weapon_skill || 'brawling';
  const attackSkill = await effectiveSkill(player, weaponSkillId);

  const enemyDodge = enemy.dodge ?? 1;
  const margin = (attackSkill - enemyDodge) + rollSwing();
  const hit = margin >= 0;

  setCooldown(player.id, 'attack');

  if (!hit) {
    return {
      success: true,
      hit: false,
      margin,
      message: `You swing at ${enemy.name} and miss. It doesn't look impressed.`,
      enemyId: enemyInstanceId,
      enemyHp: enemy.hp,
      enemyHpMax: enemy.hp_max,
    };
  }

  const critThreshold = getTunable('crit_threshold', 8);
  const critMultiplier = getTunable('crit_multiplier', 1.5);
  const critical = margin >= critThreshold;

  const damage_min = weaponStats?.damage_min || 2;
  const damage_max = weaponStats?.damage_max || 5;
  const damageType = weaponStats?.damage_type || 'kinetic';
  let damage = randInt(damage_min, damage_max);
  if (critical) damage = Math.floor(damage * critMultiplier);

  const part = rollBodyPart(enemyBodyPartWeights(enemy));
  if (part === 'head') damage = Math.floor(damage * getTunable('head_damage_multiplier', 1.5));
  damage = Math.max(1, damage - enemyPartSoak(enemy, part, damageType));
  const partLabel = PART_LABELS[part] || part;

  enemy.hp -= damage;
  enemy.targetId = player.id;

  if (enemy.hp <= 0) {
    const loot = resolveEnemyLoot(enemy);
    removeEnemyInstance(enemyInstanceId);
    return {
      success: true,
      hit: true,
      killed: true,
      critical,
      damage,
      margin,
      message: critical
        ? `CRITICAL HIT to the ${partLabel}! You deal ${damage} damage to ${enemy.name}. ${enemy.death_message}`
        : `You strike ${enemy.name}'s ${partLabel} for ${damage} damage. ${enemy.death_message}`,
      loot,
      enemyId: enemyInstanceId,
    };
  }

  return {
    success: true,
    hit: true,
    killed: false,
    critical,
    damage,
    margin,
    message: critical
      ? `CRITICAL HIT to the ${partLabel}! You deal ${damage} damage to ${enemy.name}! (${enemy.hp}/${enemy.hp_max} HP remaining)`
      : `You strike ${enemy.name}'s ${partLabel} for ${damage} damage. (${enemy.hp}/${enemy.hp_max} HP remaining)`,
    enemyId: enemyInstanceId,
    enemyHp: enemy.hp,
    enemyHpMax: enemy.hp_max,
  };
}

// Enemy attacks player — returns damage result (async: needs effectiveSkill for player dodge)
export async function enemyAttackPlayer(enemy, player) {
  const now = Date.now();
  await ensureTunables();
  const attackInterval = getTunable('enemy_attack_interval_ms', 4000);
  if (now - enemy.lastAttack < attackInterval) return null;
  const isFirstStrike = enemy.lastAttack === 0;
  enemy.lastAttack = now;

  const enemyHit = enemy.hit ?? 1;
  const playerDodge = await effectiveSkill(player, 'dodge');
  const margin = (enemyHit - playerDodge) + rollSwing();
  const hit = margin >= 0;

  const cries = enemy.flags?.battle_cries;
  const cry = (isFirstStrike && Array.isArray(cries) && cries.length)
    ? `<span class="battle-cry">${enemy.name} ${cries[Math.floor(Math.random() * cries.length)]}</span>\n`
    : '';

  if (!hit) {
    return { hit: false, message: `${cry}${enemy.name} attacks you and misses.` };
  }

  const critThreshold = getTunable('crit_threshold', 8);
  const critMultiplier = getTunable('crit_multiplier', 1.5);
  const critical = margin >= critThreshold;

  // Multi-component attack: roll each typed component, soak it against the
  // struck part's matching armor type, then sum. Crit and head bonuses apply
  // to every component before its own soak.
  const components = enemyWeaponComponents(enemy);
  const part = rollBodyPart();
  const headMult = part === 'head' ? getTunable('head_damage_multiplier', 1.5) : 1;
  // TODO(phase5): head crit-to-stun once a turn-skip mechanic exists.
  let total = 0;
  for (const c of components) {
    let amt = randInt(c.min, c.max);
    if (critical) amt = Math.floor(amt * critMultiplier);
    amt = Math.floor(amt * headMult);
    total += Math.max(0, amt - playerPartSoak(player, part, c.type));
  }
  const damage = Math.max(1, total);
  const partLabel = PART_LABELS[part] || part;

  return {
    hit: true,
    damage,
    critical,
    message: critical
      ? `${cry}CRITICAL! ${enemy.name} hits your ${partLabel} for ${damage} damage!`
      : `${cry}${enemy.name} hits your ${partLabel} for ${damage} damage.`,
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

// tickStatuses has moved to server/engine/effects.js as tickEffects.
