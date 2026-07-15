import { world, getEnemyInstance, removeEnemyInstance, getLivePlayer, getZonePlayers, tryBattleCry } from './world.js';
import { getNpcCombatLine } from './npc-personality.js';
import { effectiveSkill, awardSkillUse } from './skills.js';
import { ensureTunables, getTunable } from './tunables.js';
import { getZoneVisibility, lightHitPenalty } from './environment.js';
import { fireHook } from './plugins.js';
import { getZoneProtection } from './protection.js';
import { query } from '../models/db.js';

// Darkness to-hit penalty for an attacker swinging in `zoneId`, from the
// attacker's OWN perceived light. Pass the attacking player as `perceiver` so a
// carried light source (lit flashlight, via the visibility.perceive hook) can
// lift the room out of darkness for them; monsters pass none and eat the raw
// zone darkness. Returns 0 or a negative number to add straight onto the margin.
async function darknessHitPenalty(zoneId, perceiver = null) {
  const vis = getZoneVisibility(zoneId);
  if (perceiver) {
    const perceived = await fireHook('visibility.perceive', perceiver, vis);
    if (perceived) vis.category = perceived.category;
  }
  return lightHitPenalty(vis.category);
}

// Quoted cry  → speech:  Name says: "..."   (name prepended as speaker)
// Unquoted cry → emote:   raw text as-is    ($enemy token already substituted in)
export function formatBattleCry(name, raw) {
  return (raw.startsWith('"') && raw.endsWith('"'))
    ? `<span style="color:var(--yellow)">${name} says: ${raw}</span>`
    : `<span class="battle-cry">${raw}</span>`;
}

// Player-initiated combat provider — the weapon plugin registers its
// { resolveAttack, resolveAttackNpc, offlineSleepSwing } here at load, and the
// gameLoop auto-attack tick calls through it (raw function calls, per ADR-0001;
// only the *ownership* moved to the plugin). If the plugin fails to load, the
// tick guard logs loudly instead of silently dropping combat.
let playerCombat = null;
export function registerPlayerCombat(fns) { playerCombat = fns; }
export function getPlayerCombat() { return playerCombat; }

const COOLDOWNS = {
  attack: 3500,
  flee: 4000,
  use_item: 2500,
  shove: 60000,
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

const DEFAULT_BODY_PART_WEIGHTS = { head:10, torso:40, left_arm:12, right_arm:12, left_leg:11, right_leg:11, feet:4 };

// Which equip slot covers each struck body part. Arms share the hands piece,
// legs share the legs piece, feet has its own boots piece.
const PART_TO_SLOT = {
  head: 'head', torso: 'torso',
  left_arm: 'hands', right_arm: 'hands',
  left_leg: 'legs', right_leg: 'legs',
  feet: 'feet',
};

const PART_LABELS = {
  head: 'head', torso: 'torso',
  left_arm: 'left arm', right_arm: 'right arm',
  left_leg: 'left leg', right_leg: 'right leg',
  feet: 'feet',
};

// ── Inline combat markup ──────────────────────────────────────────────
// Combat lines render via innerHTML on the client, so we wrap the variable
// bits in semantic spans (styled in client/game/styles.css). The text HP bar
// uses block glyphs (UTF-8) and a tier class so it recolours green→yellow→red.
const HP_BAR_SEGMENTS = 10;

function hpBar(hp, max) {
  hp = Math.max(0, hp);
  const ratio = max > 0 ? hp / max : 0;
  const filled = Math.round(HP_BAR_SEGMENTS * ratio);
  const bar = '█'.repeat(filled) + '░'.repeat(HP_BAR_SEGMENTS - filled);
  const tier = ratio > 0.5 ? 'high' : ratio > 0.25 ? 'mid' : 'low';
  return { bar, tier, hp, max };
}

// Trailing HP readout for the enemy you just struck (the enemy's name already
// appears earlier in the line, so no extra owner label is needed).
function enemyHpTag(enemy) {
  const { bar, tier, hp, max } = hpBar(enemy.hp, enemy.hp_max);
  return ` <span class="hpbar hp-${tier}">[${bar}]</span> <span class="hp-count">${hp}/${max}</span>`;
}

// Trailing HP readout for your own health on incoming hits.
function selfHpTag(hp, max) {
  const { bar, tier, hp: shown, max: cap } = hpBar(hp, max);
  return ` <span class="hpbar hp-${tier}">[${bar}]</span> <span class="hp-count">${shown}/${cap}</span>`;
}

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

// Total soak for a player on the struck part: typed armor_soak on that slot.
function playerPartSoak(player, part, damageType) {
  const entry = player.soak?.[PART_TO_SLOT[part]];
  if (!entry) return 0;
  return resolveSoak(entry.soak, damageType);
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
// Monsters with no body_parts take full damage (0 soak).
function enemyPartSoak(enemy, part, damageType) {
  const parts = enemy.body_parts;
  if (Array.isArray(parts) && parts.length) {
    const entry = parts.find(p => p && p.part === part);
    return entry ? resolveSoak(entry.soak, damageType) : 0;
  }
  return 0;
}

// A monster's attack as a list of typed damage components ({type,min,max}).
// Monsters with no weapon array fall back to an unarmed strike.
function enemyWeaponComponents(enemy) {
  if (Array.isArray(enemy.weapon) && enemy.weapon.length) {
    return enemy.weapon.map(c => ({
      type: c.type || 'kinetic',
      min: Number(c.min) || 0,
      max: Number(c.max) || 0,
    }));
  }
  return [{ type: enemy.flags?.damage_type || 'kinetic', min: 1, max: 3 }];
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

  const weaponSkillId = weaponStats?.weapon_skill || 'fists';
  const attackSkill = await effectiveSkill(player, weaponSkillId);

  const enemyDodge = enemy.dodge ?? 1;
  const margin = (attackSkill - enemyDodge) + rollSwing() + await darknessHitPenalty(enemy.zoneId, player);
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
    player.mob_kills = (player.mob_kills || 0) + 1;
    query('UPDATE players SET mob_kills=mob_kills+1 WHERE id=$1', [player.id]).catch(() => {});
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
        ? `<span class="crit-tag">CRITICAL HIT</span> to the <span class="hit-part">${partLabel}</span>! You deal <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageType}</span> to ${enemy.name}. ${enemy.death_message}`
        : `You strike ${enemy.name}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageType}</span>. ${enemy.death_message}`,
      loot,
      enemyId: enemyInstanceId,
      butcher_table: enemy.butcher_table || [],
      butcher_difficulty: enemy.butcher_difficulty ?? 5,
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
      ? `<span class="crit-tag">CRITICAL HIT</span> to the <span class="hit-part">${partLabel}</span>! You deal <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageType}</span> to ${enemy.name}!${enemyHpTag(enemy)}`
      : `You strike ${enemy.name}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageType}</span>.${enemyHpTag(enemy)}`,
    enemyId: enemyInstanceId,
    enemyHp: enemy.hp,
    enemyHpMax: enemy.hp_max,
  };
}

// Enemy attacks player — returns damage result (async: needs effectiveSkill for player dodge)
export async function enemyAttackPlayer(enemy, player) {
  // A quantum forcefield shields its zone from all hostile touch — the same law
  // that stops a player's swing (getZoneProtection) stops an enemy's. The claws
  // wash off the blue field, harmless. No cooldown burn: it's as if no swing landed.
  if (getZoneProtection(player.current_zone)) return null;
  const now = Date.now();
  await ensureTunables();
  const attackInterval = getTunable('enemy_attack_interval_ms', 4000);
  if (now - enemy.lastAttack < attackInterval) return null;
  const isFirstStrike = enemy.lastAttack === 0;
  enemy.lastAttack = now;

  const enemyHit = enemy.hit ?? 1;
  const playerDodge = await effectiveSkill(player, 'dodge');
  const margin = (enemyHit - playerDodge) + rollSwing() + await darknessHitPenalty(enemy.zoneId);
  const hit = margin >= 0;

  const cries = enemy.flags?.battle_cries;
  const cry = (isFirstStrike && Array.isArray(cries) && cries.length && tryBattleCry(enemy.templateId, enemy.zoneId))
    ? formatBattleCry(enemy.name, cries[Math.floor(Math.random() * cries.length)].replace(/\$enemy/g, enemy.name).replace(/\$player/g, player.handle)) + '\n'
    : '';

  if (!hit) {
    // Evading trains Dodge — the closer the call, the better you learn (abs margin).
    await awardSkillUse(player.id, 'dodge', margin);
    return { hit: false, message: `${cry}${enemy.name} attacks you and misses.` };
  }

  const critThreshold = getTunable('crit_threshold', 8);
  const critMultiplier = getTunable('crit_multiplier', 1.5);
  const critical = margin >= critThreshold;

  // Multi-component attack: roll each typed component, soak it against the
  // struck part's matching armor type, then sum. Crit and head bonuses apply
  // to every component before its own soak.
  const components = enemyWeaponComponents(enemy);
  const damageTypes = [...new Set(components.map(c => c.type))].join('/');
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
  // player.hp is still pre-damage here; gameLoop decrements it after this
  // returns, so the bar reflects the same value the client receives as `hp`.
  const selfHp = selfHpTag(player.hp - damage, player.hp_max);

  return {
    hit: true,
    damage,
    critical,
    message: critical
      ? `${cry}<span class="crit-tag-in">CRITICAL!</span> ${enemy.name} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageTypes}</span>!${selfHp}`
      : `${cry}${enemy.name} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageTypes}</span>.${selfHp}`,
  };
}

// Force-kill an enemy instance outright (e.g. an admin insta-gib), running the
// same death bookkeeping a lethal swing does — kill credit, loot roll, despawn —
// and returning the killed-result shape the corpse/loot pipeline consumes. No
// to-hit, no damage roll, no message: the caller supplies the flavour.
export function killEnemyInstance(player, enemyInstanceId) {
  const enemy = getEnemyInstance(enemyInstanceId);
  if (!enemy) return null;
  player.mob_kills = (player.mob_kills || 0) + 1;
  query('UPDATE players SET mob_kills=mob_kills+1 WHERE id=$1', [player.id]).catch(() => {});
  const loot = resolveEnemyLoot(enemy);
  removeEnemyInstance(enemyInstanceId);
  return {
    killed: true,
    loot,
    enemyId: enemyInstanceId,
    butcher_table: enemy.butcher_table || [],
    butcher_difficulty: enemy.butcher_difficulty ?? 5,
  };
}

// Force-kill an NPC outright (e.g. an admin insta-gib). Mirrors the death
// bookkeeping in playerAttackNpc: mark dead, schedule the 60s respawn, drop it
// from the zone. Returns the NPC object (for events/messaging) or null if it's
// already gone/dead. Caller emits npc.killed and supplies the flavour.
export function killNpcInstance(npcId) {
  const npc = world.npcs.get(npcId);
  if (!npc || npc._dead) return null;
  npc.hp = 0;
  npc._dead = true;
  npc._respawnAt = Date.now() + 60000;
  world.zones.get(npc.zone_id)?.npcs.delete(npcId);
  return npc;
}

// Apply a single strike to a player from a NON-melee source — an aircraft cannon
// raking the tile, a wreck coming down on them. Rolls a body part, subtracts that
// part's typed soak (so a kevlar vest still helps under a strafing run), writes HP,
// and reports whether it was lethal. No to-hit and no cooldown: the caller owns the
// hit roll and its own fire-rate gate. Lethal outcomes are left for the caller to
// route through handlePlayerDeath.
export async function applyStrikeToPlayer(player, { min, max, damageType = 'kinetic' }) {
  await ensureTunables();
  const part = rollBodyPart();
  let damage = randInt(min, max);
  if (part === 'head') damage = Math.floor(damage * getTunable('head_damage_multiplier', 1.5));
  damage = Math.max(1, damage - playerPartSoak(player, part, damageType));
  const before = player.hp ?? player.hp_max ?? 100;
  player.hp = Math.max(0, before - damage);
  await query('UPDATE players SET hp=$1 WHERE id=$2', [player.hp, player.id]);
  return { damage, part, partLabel: PART_LABELS[part] || part, killed: player.hp <= 0 };
}

function resolveEnemyLoot(enemy) {
  const drops = [];
  for (const entry of enemy.loot_table) {
    if (Math.random() * 100 < entry.weight) {
      const qty = Array.isArray(entry.qty)
        ? Math.floor(Math.random() * (entry.qty[1] - entry.qty[0] + 1)) + entry.qty[0]
        : 1;
      const drop = { item_id: entry.item, quantity: qty };
      // A credit-chip entry rolls a variable denomination (entry.credits: [min,max]
      // or a fixed int) stamped onto the instance so `use` pays out exactly that.
      if (entry.credits != null) {
        const [lo, hi] = Array.isArray(entry.credits) ? entry.credits : [entry.credits, entry.credits];
        const amt = Math.floor(Math.random() * (hi - lo + 1)) + lo;
        drop.custom_data = { credits: amt, name: `credit chip (₵${amt})` };
      }
      drops.push(drop);
    }
  }
  return drops;
}

// tickStatuses has moved to server/engine/effects.js as tickEffects.

// One PvP attack tick: attacker swings at defender using the full combat system.
// Returns { hit, killed, attackerMsg, defenderMsg, damage?, defenderHp?, defenderHpMax? }
// or null when on cooldown or defender already dead.
export async function pvpSwing(attacker, defender) {
  if ((defender.hp ?? defender.hp_max ?? 100) <= 0) return null;
  if (isOnCooldown(attacker.id, 'attack')) return null;
  setCooldown(attacker.id, 'attack');
  await ensureTunables();

  const { rows } = await query(
    `SELECT i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id
     WHERE pi.player_id=$1 AND pi.is_equipped=1 AND jsonb_exists(i.tags,'weapon') LIMIT 1`,
    [attacker.id]
  );
  const equipped = rows[0];
  const dmg = equipped?.tags?.damage || {};
  const weaponSkill = equipped?.tags?.weapon_skill || 'fists';
  const damageType = equipped?.tags?.damage_type || 'kinetic';
  const damage_min = dmg.min ?? 2;
  const damage_max = dmg.max ?? 4;

  const attackSkill = await effectiveSkill(attacker, weaponSkill);
  const defDodge = await effectiveSkill(defender, 'dodge');
  const margin = (attackSkill - defDodge) + rollSwing() + await darknessHitPenalty(attacker.current_zone, attacker);
  const hit = margin >= 0;

  if (!hit) {
    // Defender trains Dodge for evading — the closer the call, the better (abs margin).
    await awardSkillUse(defender.id, 'dodge', margin);
    return {
      hit: false,
      killed: false,
      attackerMsg: `You swing at ${defender.handle} and miss.`,
      defenderMsg: `${attacker.handle} swings at you and misses.`,
    };
  }

  const critical = margin >= getTunable('crit_threshold', 8);
  const part = rollBodyPart();
  const partLabel = PART_LABELS[part] || part;
  const headMult = part === 'head' ? getTunable('head_damage_multiplier', 1.5) : 1;

  let damage = randInt(damage_min, damage_max);
  if (critical) damage = Math.floor(damage * getTunable('crit_multiplier', 1.5));
  damage = Math.floor(damage * headMult);
  damage = Math.max(1, damage - playerPartSoak(defender, part, damageType));

  const defHpBefore = defender.hp ?? defender.hp_max ?? 100;
  defender.hp = Math.max(0, defHpBefore - damage);
  const defHpMax = defender.hp_max ?? 100;
  await query('UPDATE players SET hp=$1 WHERE id=$2', [defender.hp, defender.id]);

  const killed = defender.hp <= 0;
  const defHpTag = killed ? '' : selfHpTag(defender.hp, defHpMax);

  const attackerMsg = critical
    ? `<span class="crit-tag">CRITICAL HIT</span> to ${defender.handle}'s <span class="hit-part">${partLabel}</span>! You deal <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageType}</span>.`
    : `You hit ${defender.handle}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageType}</span>.`;
  const defenderMsg = critical
    ? `<span class="crit-tag-in">CRITICAL!</span> ${attacker.handle} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageType}</span>!${defHpTag}`
    : `${attacker.handle} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageType}</span>.${defHpTag}`;

  return { hit: true, killed, damage, attackerMsg, defenderMsg, defenderHp: defender.hp, defenderHpMax: defHpMax };
}

// Player attacks an NPC. NPCs have no armor (0 soak). Returns same shape as playerAttackEnemy.
export async function playerAttackNpc(player, npcId, weaponStats) {
  if (isOnCooldown(player.id, 'attack')) {
    return { success: false, message: `You're still recovering. (${(getCooldownRemaining(player.id, 'attack') / 1000).toFixed(1)}s)` };
  }
  const npc = world.npcs.get(npcId);
  if (!npc) return { success: false, message: "That target is gone." };
  if (npc.zone_id !== player.current_zone) return { success: false, message: "That target isn't here." };
  if (npc._dead) return { success: false, message: `${npc.name} is already dead.` };
  // Some NPCs cannot be attacked at all (tutorial attendants, protected quest-givers).
  // A general seam: flags.no_attack refuses combat; flags.no_attack_message flavors it.
  if (npc.flags?.no_attack) {
    return { success: false, message: npc.flags.no_attack_message || `Something stops you. ${npc.name} cannot be harmed.` };
  }

  await ensureTunables();
  const weaponSkillId = weaponStats?.weapon_skill || 'fists';
  const attackSkill = await effectiveSkill(player, weaponSkillId);
  const npcDodge = npc.flags?.dodge ?? 1;
  const margin = (attackSkill - npcDodge) + rollSwing() + await darknessHitPenalty(npc.zone_id, player);
  const hit = margin >= 0;
  setCooldown(player.id, 'attack');

  if (!hit) {
    return { success: true, hit: false, margin, npcId, message: `You swing at ${npc.name} and miss.` };
  }

  const critical = margin >= getTunable('crit_threshold', 8);
  const damage_min = weaponStats?.damage_min || 2;
  const damage_max = weaponStats?.damage_max || 5;
  const damageType = weaponStats?.damage_type || 'kinetic';
  let damage = randInt(damage_min, damage_max);
  if (critical) damage = Math.floor(damage * getTunable('crit_multiplier', 1.5));
  const part = rollBodyPart(null);
  if (part === 'head') damage = Math.floor(damage * getTunable('head_damage_multiplier', 1.5));
  damage = Math.max(1, damage);
  const partLabel = PART_LABELS[part] || part;

  npc.hp = Math.max(0, (npc.hp ?? npc.hp_max ?? 20) - damage);
  npc._combatTargetId = player.id;

  const npcSpeech = getNpcCombatLine(npc);

  if (npc.hp <= 0) {
    npc._dead = true;
    npc._respawnAt = Date.now() + 60000;
    const zone = world.zones.get(player.current_zone);
    if (zone) zone.npcs.delete(npcId);
    return {
      success: true, hit: true, killed: true, critical, damage, margin, npcId, npcSpeech,
      message: critical
        ? `<span class="crit-tag">CRITICAL HIT</span> to the <span class="hit-part">${partLabel}</span>! You deal <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageType}</span> to ${npc.name}. They crumple.`
        : `You strike ${npc.name}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageType}</span>. They crumple.`,
    };
  }

  const { bar, tier } = hpBar(npc.hp, npc.hp_max ?? 20);
  const hpTag = ` <span class="hpbar hp-${tier}">[${bar}]</span> <span class="hp-count">${npc.hp}/${npc.hp_max ?? 20}</span>`;
  return {
    success: true, hit: true, killed: false, critical, damage, margin, npcId, npcSpeech,
    npcHp: npc.hp, npcHpMax: npc.hp_max ?? 20,
    message: critical
      ? `<span class="crit-tag">CRITICAL HIT</span> to the <span class="hit-part">${partLabel}</span>! You deal <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageType}</span> to ${npc.name}!${hpTag}`
      : `You strike ${npc.name}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageType}</span>.${hpTag}`,
  };
}

// Enemy attacks NPC. Uses same timing as enemyAttackPlayer. Returns result or null when on cooldown.
export async function enemyAttackNpc(enemy, npc) {
  if (!npc || npc._dead) return null;
  const now = Date.now();
  await ensureTunables();
  const attackInterval = getTunable('enemy_attack_interval_ms', 4000);
  if (now - enemy.lastAttack < attackInterval) return null;
  enemy.lastAttack = now;

  const margin = (enemy.hit ?? 1) - (npc.flags?.dodge ?? 1) + rollSwing() + await darknessHitPenalty(npc.zone_id);
  const hit = margin >= 0;
  if (!hit) {
    return { hit: false, killed: false, npcId: npc.id, message: `${enemy.name} attacks ${npc.name} and misses.` };
  }

  const critical = margin >= getTunable('crit_threshold', 8);
  const components = enemyWeaponComponents(enemy);
  const damageTypes = [...new Set(components.map(c => c.type))].join('/');
  const part = rollBodyPart();
  const headMult = part === 'head' ? getTunable('head_damage_multiplier', 1.5) : 1;
  let total = 0;
  for (const c of components) {
    let amt = randInt(c.min, c.max);
    if (critical) amt = Math.floor(amt * getTunable('crit_multiplier', 1.5));
    total += Math.floor(amt * headMult);
  }
  const damage = Math.max(1, total);
  const partLabel = PART_LABELS[part] || part;

  npc.hp = Math.max(0, (npc.hp ?? npc.hp_max ?? 20) - damage);
  npc._combatTargetId = enemy.instanceId;

  const npcSpeech = getNpcCombatLine(npc);
  const killed = npc.hp <= 0;
  if (killed) {
    npc._dead = true;
    npc._respawnAt = Date.now() + 60000;
    const zone = world.zones.get(npc.zone_id);
    if (zone) zone.npcs.delete(npc.id);
  }

  return {
    hit: true, damage, critical, killed, npcId: npc.id, npcSpeech,
    message: critical
      ? `<span class="crit-tag">CRITICAL HIT</span> ${enemy.name} hits ${npc.name}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageTypes}</span>!${killed ? ' They go down.' : ''}`
      : `${enemy.name} hits ${npc.name}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageTypes}</span>.${killed ? ' They go down.' : ''}`,
  };
}

// Enemy attacks another enemy instance. Uses the same timing/formula as enemyAttackNpc.
export async function enemyAttackEnemy(attacker, defender) {
  if (!defender || defender._dead) return null;
  const now = Date.now();
  await ensureTunables();
  const attackInterval = getTunable('enemy_attack_interval_ms', 4000);
  if (now - attacker.lastAttack < attackInterval) return null;
  attacker.lastAttack = now;

  const margin = (attacker.hit ?? 1) - (defender.flags?.dodge ?? 1) + rollSwing() + await darknessHitPenalty(defender.zoneId);
  const hit = margin >= 0;
  if (!hit) {
    return { hit: false, killed: false, message: `${attacker.name} attacks ${defender.name} and misses.` };
  }

  const critical = margin >= getTunable('crit_threshold', 8);
  const components = enemyWeaponComponents(attacker);
  const damageTypes = [...new Set(components.map(c => c.type))].join('/');
  const part = rollBodyPart();
  const headMult = part === 'head' ? getTunable('head_damage_multiplier', 1.5) : 1;
  let total = 0;
  for (const c of components) {
    let amt = randInt(c.min, c.max);
    if (critical) amt = Math.floor(amt * getTunable('crit_multiplier', 1.5));
    total += Math.floor(amt * headMult);
  }
  const damage = Math.max(1, total);
  const partLabel = PART_LABELS[part] || part;

  defender.hp = Math.max(0, (defender.hp ?? defender.hp_max ?? 20) - damage);
  const killed = defender.hp <= 0;
  if (killed) {
    defender._dead = true;
    const zone = world.zones.get(defender.zoneId);
    if (zone) zone.enemies.delete(defender.instanceId);
  }

  return {
    hit: true, damage, critical, killed,
    message: critical
      ? `<span class="crit-tag">CRITICAL HIT</span> ${attacker.name} hits ${defender.name}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageTypes}</span>!${killed ? ' They go down.' : ''}`
      : `${attacker.name} hits ${defender.name}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageTypes}</span>.${killed ? ' They go down.' : ''}`,
  };
}

// NPC retaliates against a player. Returns { hit, damage, message } or null when on cooldown.
export async function npcAttackPlayer(npc, player) {
  if (npc._dead) return null;
  if (getZoneProtection(player.current_zone)) return null;   // quantum forcefield repels NPC blows too
  const now = Date.now();
  await ensureTunables();
  const attackInterval = getTunable('enemy_attack_interval_ms', 4000);
  if (now - (npc._lastAttack || 0) < attackInterval) return null;
  npc._lastAttack = now;

  const npcHit = npc.flags?.hit ?? 1;
  const playerDodge = await effectiveSkill(player, 'dodge');
  const margin = (npcHit - playerDodge) + rollSwing() + await darknessHitPenalty(npc.zone_id);
  const hit = margin >= 0;

  if (!hit) {
    // Evading trains Dodge — the closer the call, the better you learn (abs margin).
    await awardSkillUse(player.id, 'dodge', margin);
    return { hit: false, message: `${npc.name} attacks you and misses.` };
  }

  const critical = margin >= getTunable('crit_threshold', 8);
  const weaponArr = Array.isArray(npc.flags?.weapon) && npc.flags.weapon.length
    ? npc.flags.weapon
    : [{ type: 'kinetic', min: 1, max: 3 }];
  const damageTypes = [...new Set(weaponArr.map(c => c.type))].join('/');
  const part = rollBodyPart();
  const headMult = part === 'head' ? getTunable('head_damage_multiplier', 1.5) : 1;
  let total = 0;
  for (const c of weaponArr) {
    let amt = randInt(Number(c.min) || 1, Number(c.max) || 3);
    if (critical) amt = Math.floor(amt * getTunable('crit_multiplier', 1.5));
    total += Math.max(0, Math.floor(amt * headMult) - playerPartSoak(player, part, c.type));
  }
  const damage = Math.max(1, total);
  const partLabel = PART_LABELS[part] || part;

  return {
    hit: true, damage, critical,
    message: critical
      ? `<span class="crit-tag-in">CRITICAL!</span> ${npc.name} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageTypes}</span>!${selfHpTag(player.hp - damage, player.hp_max)}`
      : `${npc.name} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageTypes}</span>.${selfHpTag(player.hp - damage, player.hp_max)}`,
  };
}

// Like pvpSwing but for a sleeping/offline defender: always hits, no dodge roll.
// defender is a plain DB row (offline player); soak is 0 since it's not cached.
export async function pvpSwingSleeping(attacker, defender) {
  if ((defender.hp ?? defender.hp_max ?? 100) <= 0) return null;
  if (isOnCooldown(attacker.id, 'attack')) return null;
  setCooldown(attacker.id, 'attack');
  await ensureTunables();

  const { rows } = await query(
    `SELECT i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id
     WHERE pi.player_id=$1 AND pi.is_equipped=1 AND jsonb_exists(i.tags,'weapon') LIMIT 1`,
    [attacker.id]
  );
  const equipped = rows[0];
  const dmg = equipped?.tags?.damage || {};
  const damageType = equipped?.tags?.damage_type || 'kinetic';
  const damage_min = dmg.min ?? 2;
  const damage_max = dmg.max ?? 4;

  const critical = Math.random() < 0.1;
  const part = rollBodyPart();
  const partLabel = PART_LABELS[part] || part;
  const headMult = part === 'head' ? getTunable('head_damage_multiplier', 1.5) : 1;

  let damage = randInt(damage_min, damage_max);
  if (critical) damage = Math.floor(damage * getTunable('crit_multiplier', 1.5));
  damage = Math.floor(damage * headMult);
  damage = Math.max(1, damage);

  const defHpBefore = defender.hp ?? defender.hp_max ?? 100;
  const newHp = Math.max(0, defHpBefore - damage);
  const defHpMax = defender.hp_max ?? 100;
  await query('UPDATE players SET hp=$1 WHERE id=$2', [newHp, defender.id]);

  const killed = newHp <= 0;

  const hpReadout = killed ? '' : enemyHpTag({ hp: newHp, hp_max: defHpMax });
  const attackerMsg = critical
    ? `<span class="crit-tag">CRITICAL HIT</span> to ${defender.handle}'s <span class="hit-part">${partLabel}</span>! You deal <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageType}</span>.${hpReadout}`
    : `You hit ${defender.handle}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageType}</span>.${hpReadout}`;

  return { hit: true, killed, damage, attackerMsg, defenderHp: newHp, defenderHpMax: defHpMax };
}
