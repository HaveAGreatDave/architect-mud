import { world, getEnemyInstance, removeEnemyInstance, getLivePlayer, getZonePlayers, getZoneEnemies, getZoneNpcs, tryBattleCry } from './world.js';
import { getNpcCombatLine } from './npc-personality.js';
import { effectiveSkill, awardSkillUse } from './skills.js';
import { ensureTunables, getTunable } from './tunables.js';
import { getZoneVisibility, lightHitPenalty } from './environment.js';
import { fireHook } from './plugins.js';
import { getZoneProtection } from './protection.js';
import { query } from '../models/db.js';
import { getEquippedWeapon } from './inventory.js';
import { wear, WEAR_EVENTS, conditionPenalty, announceWear } from './durability.js';
import { BASE_ATTACK_MS, hitBonus, defenseBonus, swingInterval, consumeDodge, swingVerb, missLine } from './stance.js';

// A power attack (`pow`) multiplies the rolled damage after crit and before the
// head bonus and soak, and costs 1.5x the stance's swing time.
const POW_DAMAGE_MULT = 2.5;
const POW_SWING_MULT = 1.5;

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
  attack: BASE_ATTACK_MS,   // the BASE swing — stance shifts it, see setCooldown's override
  use_item: 2500,
  shove: 60000,
  stance: 60000,            // `fight <stance>` — locks you into your choice
  combat_move: 10000,       // shared by `pow` and `dodge`: one window, pick offense or defense
};

// playerId -> { action -> { at, dur } }. The DURATION is stamped at set time
// rather than looked up at read time, because the attack cooldown is now
// per-player and variable (stance speed, pow's 1.5x, the dodge lock) while the
// ~8 isOnCooldown(id,'attack') readers across gameLoop.js and the weapon plugin
// have no stance in hand. Changing the writer keeps every reader untouched.
const playerCooldowns = new Map();

export function isOnCooldown(playerId, action) {
  const entry = playerCooldowns.get(playerId)?.[action];
  if (!entry) return false;
  return Date.now() - entry.at < entry.dur;
}

export function setCooldown(playerId, action, durationMs = null) {
  const cds = playerCooldowns.get(playerId) || {};
  cds[action] = { at: Date.now(), dur: durationMs ?? COOLDOWNS[action] ?? 1000 };
  playerCooldowns.set(playerId, cds);
}

export function getCooldownRemaining(playerId, action) {
  const entry = playerCooldowns.get(playerId)?.[action];
  if (!entry) return 0;
  return Math.max(0, entry.dur - (Date.now() - entry.at));
}

// Ends a cooldown early. Used when a dodge window is consumed by an incoming
// swing before its 5s runs out — the attack lock that enforced "you cannot
// attack for the duration" should lift with it.
export function clearCooldown(playerId, action) {
  const cds = playerCooldowns.get(playerId);
  if (cds) delete cds[action];
}

// ── Contested flee ───────────────────────────────────────────────────────────
// You can't simply walk out of a fight any more: breaking contact costs an
// attack cycle and a roll, in both directions. Same shape as every to-hit in
// this file — a flat rating comparison plus the symmetric 2d8−2d8 swing — so a
// dangerous attacker is genuinely harder to escape than a weak one.
//
// The fleer eats a flat −1 on top: turning your back is supposed to cost you.
export const FLEE_DODGE_PENALTY = 1;

export function rollFleeContest(fleeRating, attackerHit) {
  return (fleeRating - FLEE_DODGE_PENALTY - attackerHit) + rollSwing();
}

// Everyone actively swinging at this player right now — hostile enemies and NPCs
// that have locked onto them, plus any live player holding them as a PvP target.
// Deliberately NOT "things the player is attacking": you can always walk away
// from a target that isn't fighting back.
export function attackersOf(player) {
  const out = [];
  for (const e of getZoneEnemies(player.current_zone)) {
    if (e.targetId === player.id && !e._dead) out.push({ name: e.name, hit: e.hit ?? 1 });
  }
  for (const n of getZoneNpcs(player.current_zone)) {
    if (n._combatTargetId === player.id && !n._dead) out.push({ name: n.name, hit: n.flags?.hit ?? 1 });
  }
  for (const p of getZonePlayers(player.current_zone)) {
    if (p.id !== player.id && p.pvpTargetId === player.id) out.push({ name: p.handle, hit: 1, player: p });
  }
  return out;
}

// The toughest thing currently on you — the one you have to slip. Null when
// nobody is attacking, which is the "movement is free" case.
export function toughestAttacker(player) {
  const all = attackersOf(player);
  if (!all.length) return null;
  return all.reduce((best, a) => (a.hit > best.hit ? a : best), all[0]);
}

// The player half of the contest: dodge skill plus stance defense (so pacifist
// really is the escape stance), against the best attacker in the room. Trains
// Dodge on the attempt whether it lands or not, like every other evasion.
export async function playerFleeRoll(player, attackerHit) {
  const rating = (await effectiveSkill(player, 'dodge')) + defenseBonus(player);
  const margin = rollFleeContest(rating, attackerHit);
  await awardSkillUse(player.id, 'dodge', margin);
  return margin >= 0;
}

// The mob half. Enemies use their flat `dodge` rating (or an explicit
// flags.flee_skill override, which the old FLEE node already honoured).
export function mobFleeRoll(entity, attackerHit) {
  const rating = Number(entity?.flags?.flee_skill ?? entity?.dodge ?? entity?.flags?.dodge ?? 1);
  return rollFleeContest(rating, attackerHit) >= 0;
}

// The player (if any) currently pressing an attack on this enemy/NPC — the
// mirror of attackersOf(). Synchronous by design: moveEntity is the single
// writer for every mob tile change and can't await, so the attacker's swing
// skill is read from the value their last swing stamped on them.
export function pressingAttacker(entity) {
  if (!entity) return null;
  const zoneId = entity.zoneId || entity.zone_id;
  const isEnemyInstance = !!entity.instanceId;
  for (const p of getZonePlayers(zoneId)) {
    const pressing = isEnemyInstance
      ? p.combatTargetId === entity.instanceId
      : p.npcCombatTargetId === entity.id;
    if (pressing) return { name: p.handle, hit: p._lastAttackSkill ?? 1 };
  }
  return null;
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

// A power attack's 1.5x cost is charged UP FRONT, as a wind-up, the moment `pow`
// is typed — it RESETS the swing timer rather than waiting for it. That's the
// whole shape of the move: you throw away whatever progress the current swing
// had and commit to a longer one.
//
// Which is why the swing that eventually lands charges only the plain stance
// interval (below): charging 1.5x again on the way out would make the move cost
// 3x a swing instead of 1.5x.
export function powWindupMs(player) {
  return Math.round(swingInterval(player) * POW_SWING_MULT);
}

// `pow` arms a ONE-SHOT flag that the next swing spends. The weapon plugin arms
// it; the engine swing functions below are the only consumers, and they take it
// only after every early return has passed — so a swing that never happened (on
// cooldown, target gone) doesn't silently eat the move.
//
// It must be consumed rather than read, because resolveAttack rebuilds
// weaponStats from scratch on EVERY swing including auto-attack ticks: a flag
// that merely persisted would turn the whole auto-attack loop into power attacks.
export function queuePowerAttack(player) { player._powQueued = true; }
export function hasPowerQueued(player) { return !!player._powQueued; }
function takePower(player) {
  const queued = !!player._powQueued;
  player._powQueued = false;
  return queued;
}

// The body of a player's hit line, WITHOUT trailing punctuation — callers append
// '.'/'!' plus their own death message or HP tag, matching the shapes that were
// inlined here before.
//
// Crit and pow never show two badges: a critical power attack reads as one
// CRITICAL POWER tag, because two badges on one line reads like a render bug.
// Outside a crit, the plain verb is the stance's own (strike / tear into /
// jab at / …) — the spans around it are byte-identical across stances, so the
// client CSS and the `combat` dispatch handler need no stance awareness at all.
function playerHitLine(player, targetName, partLabel, damage, damageType, critical, power) {
  const part = `<span class="hit-part">${partLabel}</span>`;
  const dmg = `<span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageType}</span>`;
  if (critical) {
    return `<span class="crit-tag">${power ? 'CRITICAL POWER' : 'CRITICAL HIT'}</span> to the ${part}! You deal ${dmg} to ${targetName}`;
  }
  if (power) return `<span class="pow-tag">POWER</span> You bring everything down on ${targetName}'s ${part} for ${dmg}`;
  return `You ${swingVerb(player)} ${targetName}'s ${part} for ${dmg}`;
}

// A whiffed power attack has to sting — you just burned 1.5 swings for nothing.
function playerMissLine(player, targetName, power) {
  return power
    ? `<span class="pow-tag">POWER</span> You commit everything — and hit nothing but air.`
    : missLine(player, targetName);
}

// The defender half of every incoming swing against a player: their dodge term
// (skill + stance defense + any live dodge-move bonus) and whether this swing is
// the one that spends their dodge window.
//
// Order matters — defenseBonus() must be read BEFORE consumeDodge() clears the
// window, or the move you just spent wouldn't apply to the swing that spent it.
// Consuming also lifts the attack lock that `dodge` set, so the 5s "you cannot
// attack" ends with the window rather than outliving it.
async function playerDefence(player) {
  const dodgeTerm = (await effectiveSkill(player, 'dodge')) + defenseBonus(player);
  const dodged = consumeDodge(player);
  if (dodged) clearCooldown(player.id, 'attack');
  return { dodgeTerm, dodged };
}

// A spent dodge window decorates the incoming line rather than adding one of its
// own — the output pane already prints a line every swing.
const DODGE_BROKEN = ' <span class="dodge-tag">(guard broken)</span>';
function dodgedMissLine(attackerName) {
  return `${attackerName} lunges — <span class="dodge-tag">you slip aside</span>.`;
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
  const slot = PART_TO_SLOT[part];
  const entry = player.soak?.[slot];
  if (!entry) return 0;
  // Condition is what makes wearing out MATTER: battered armour soaks less and
  // broken armour soaks nothing. Read from the worn row the live player already
  // caches — zero queries, same hot path as the wear accrual above.
  const worn = player._wornRows?.get(slot);
  const scale = worn ? conditionPenalty({ ...worn, _wearPending: player._wearPending?.get(worn.inv_id) }) : 1;
  return Math.floor(resolveSoak(entry.soak, damageType) * scale);
}

// ── Wear (server/engine/durability.js) ───────────────────────────────────────
//
// Both helpers are SYNCHRONOUS and query-free by contract: they read rows the
// live player already caches (`_wornRows` from recomputeEquipped, `_equippedWeapon`
// from getEquippedWeapon) and accrue into an in-memory map the game loop flushes.
// A band change is announced ONCE, here, rather than every swing.
// (announceWear now lives in durability.js — acid rain announces the same way.)

// The armour that actually absorbed the blow — not every worn piece. Getting hit
// in the leg does nothing to your helmet.
function wearStruckArmor(player, part) {
  const row = player?._wornRows?.get(PART_TO_SLOT[part]);
  if (!row) return;
  announceWear(player, row, wear(player, row, WEAR_EVENTS.taken, 'combat:taken'));
}

// The weapon that landed the blow. Fists have no row, so unarmed costs nothing.
// A battered weapon hits softer; a broken one is no better than your fists.
// Same cached row the wear accrual uses — no query.
function weaponScale(player) {
  const row = player?._equippedWeapon?.row;
  if (!row) return 1;
  return conditionPenalty({ ...row, _wearPending: player._wearPending?.get(row.inv_id) });
}

function wearHeldWeapon(player) {
  const row = player?._equippedWeapon?.row;
  if (!row) return;
  announceWear(player, row, wear(player, row, WEAR_EVENTS.swing, 'combat:swing'));
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
  // Cached for the mob-side flee contest: moveEntity is synchronous and can't
  // await effectiveSkill. A mob is only ever gated while a player is actively
  // attacking it, so by then this has always been stamped by a real swing.
  player._lastAttackSkill = attackSkill;

  const power = takePower(player);
  const enemyDodge = enemy.dodge ?? 1;
  const margin = (attackSkill + hitBonus(player) - enemyDodge) + rollSwing() + await darknessHitPenalty(enemy.zoneId, player);
  const hit = margin >= 0;

  setCooldown(player.id, 'attack', swingInterval(player));

  if (!hit) {
    return {
      success: true,
      hit: false,
      margin,
      power,
      message: playerMissLine(player, enemy.name, power),
      enemyId: enemyInstanceId,
      enemyHp: enemy.hp,
      enemyHpMax: enemy.hp_max,
    };
  }

  wearHeldWeapon(player);   // the swing landed — the weapon that landed it wears
  const critThreshold = getTunable('crit_threshold', 8);
  const critMultiplier = getTunable('crit_multiplier', 1.5);
  const critical = margin >= critThreshold;

  const damage_min = weaponStats?.damage_min || 2;
  const damage_max = weaponStats?.damage_max || 5;
  const damageType = weaponStats?.damage_type || 'kinetic';
  let damage = randInt(damage_min, damage_max);
  damage = Math.max(1, Math.round(damage * weaponScale(player)));
  if (critical) damage = Math.floor(damage * critMultiplier);
  if (power) damage = Math.floor(damage * POW_DAMAGE_MULT);

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
      power,
      message: `${playerHitLine(player, enemy.name, partLabel, damage, damageType, critical, power)}. ${enemy.death_message}`,
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
    power,
    message: `${playerHitLine(player, enemy.name, partLabel, damage, damageType, critical, power)}${critical ? '!' : '.'}${enemyHpTag(enemy)}`,
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
  const { dodgeTerm, dodged } = await playerDefence(player);
  const margin = (enemyHit - dodgeTerm) + rollSwing() + await darknessHitPenalty(enemy.zoneId);
  const hit = margin >= 0;

  const cries = enemy.flags?.battle_cries;
  const cry = (isFirstStrike && Array.isArray(cries) && cries.length && tryBattleCry(enemy.templateId, enemy.zoneId))
    ? formatBattleCry(enemy.name, cries[Math.floor(Math.random() * cries.length)].replace(/\$enemy/g, enemy.name).replace(/\$player/g, player.handle)) + '\n'
    : '';

  if (!hit) {
    // Evading trains Dodge — the closer the call, the better you learn (abs margin).
    await awardSkillUse(player.id, 'dodge', margin);
    return { hit: false, message: `${cry}${dodged ? dodgedMissLine(enemy.name) : `${enemy.name} attacks you and misses.`}` };
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
  wearStruckArmor(player, part);
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
      ? `${cry}<span class="crit-tag-in">CRITICAL!</span> ${enemy.name} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageTypes}</span>!${dodged ? DODGE_BROKEN : ''}${selfHp}`
      : `${cry}${enemy.name} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageTypes}</span>.${dodged ? DODGE_BROKEN : ''}${selfHp}`,
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
// Coalesced combat-resource write, called once per second at the end of the combat
// tick (gameLoop.js). hp/stamina change fast — every swing, every status-effect tick —
// but the row write is durability-only: RAM is authoritative (combat reads player.hp
// from world.players). Rather than one UPDATE per swing (N/sec per combatant), the
// damage/effect sites just set player._resDirty; this batches every dirty player into
// ONE round trip. Crash-loss is bounded to ≤1s of combat — a negligible reward for
// crashing, so hp stays effectively durable while the per-swing write storm collapses
// to a single UPDATE. Death and graceful logout still write hp through immediately, so
// neither relies on this flush. Offline defenders (pvpSwingSleeping) are DB rows, not
// live players, and keep their own direct write.
export async function flushDirtyResources() {
  const dirty = [];
  for (const p of world.players.values()) if (p._resDirty) dirty.push(p);
  if (!dirty.length) return;
  const rows = [];
  const params = [];
  dirty.forEach((p, i) => {
    const b = i * 3;
    rows.push(`($${b + 1}::text, $${b + 2}::int, $${b + 3}::int)`);
    params.push(p.id, Math.round(p.hp ?? p.hp_max ?? 0), Math.round(p.stamina ?? p.stamina_max ?? 100));
  });
  try {
    await query(
      `UPDATE players AS pl SET hp = v.hp, stamina = v.stam
       FROM (VALUES ${rows.join(', ')}) AS v(id, hp, stam)
       WHERE pl.id = v.id`,
      params
    );
    for (const p of dirty) p._resDirty = false;
  } catch (err) {
    console.error(`flushDirtyResources failed: ${err.message}`);
  }
}

// hit roll and its own fire-rate gate. Lethal outcomes are left for the caller to
// route through handlePlayerDeath.
export async function applyStrikeToPlayer(player, { min, max, damageType = 'kinetic' }) {
  await ensureTunables();
  const part = rollBodyPart();
  let damage = randInt(min, max);
  if (part === 'head') damage = Math.floor(damage * getTunable('head_damage_multiplier', 1.5));
  damage = Math.max(1, damage - playerPartSoak(player, part, damageType));
  wearStruckArmor(player, part);
  const before = player.hp ?? player.hp_max ?? 100;
  player.hp = Math.max(0, before - damage);
  player._resDirty = true; // coalesced into the 1s flushDirtyResources write
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
  const power = takePower(attacker);
  setCooldown(attacker.id, 'attack', swingInterval(attacker));
  await ensureTunables();

  const equipped = await getEquippedWeapon(attacker);
  const dmg = equipped?.tags?.damage || {};
  const weaponSkill = equipped?.tags?.weapon_skill || 'fists';
  const damageType = equipped?.tags?.damage_type || 'kinetic';
  const damage_min = dmg.min ?? 2;
  const damage_max = dmg.max ?? 4;

  const attackSkill = await effectiveSkill(attacker, weaponSkill);
  const { dodgeTerm, dodged } = await playerDefence(defender);
  const margin = (attackSkill + hitBonus(attacker) - dodgeTerm) + rollSwing() + await darknessHitPenalty(attacker.current_zone, attacker);
  const hit = margin >= 0;

  if (!hit) {
    // Defender trains Dodge for evading — the closer the call, the better (abs margin).
    await awardSkillUse(defender.id, 'dodge', margin);
    return {
      hit: false,
      killed: false,
      attackerMsg: playerMissLine(attacker, defender.handle, power),
      defenderMsg: dodged ? dodgedMissLine(attacker.handle) : `${attacker.handle} swings at you and misses.`,
    };
  }

  wearHeldWeapon(player);   // the swing landed — the weapon that landed it wears
  const critical = margin >= getTunable('crit_threshold', 8);
  const part = rollBodyPart();
  const partLabel = PART_LABELS[part] || part;
  const headMult = part === 'head' ? getTunable('head_damage_multiplier', 1.5) : 1;

  let damage = randInt(damage_min, damage_max);
  damage = Math.max(1, Math.round(damage * weaponScale(attacker)));
  if (critical) damage = Math.floor(damage * getTunable('crit_multiplier', 1.5));
  if (power) damage = Math.floor(damage * POW_DAMAGE_MULT);
  damage = Math.floor(damage * headMult);
  damage = Math.max(1, damage - playerPartSoak(defender, part, damageType));
  wearStruckArmor(defender, part);
  wearHeldWeapon(attacker);

  const defHpBefore = defender.hp ?? defender.hp_max ?? 100;
  defender.hp = Math.max(0, defHpBefore - damage);
  const defHpMax = defender.hp_max ?? 100;
  defender._resDirty = true; // coalesced into the 1s flushDirtyResources write

  const killed = defender.hp <= 0;
  const defHpTag = killed ? '' : selfHpTag(defender.hp, defHpMax);

  const attackerMsg = `${playerHitLine(attacker, defender.handle, partLabel, damage, damageType, critical, power)}${critical ? '!' : '.'}`;
  const defenderMsg = critical
    ? `<span class="crit-tag-in">CRITICAL!</span> ${attacker.handle} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageType}</span>!${dodged ? DODGE_BROKEN : ''}${defHpTag}`
    : `${attacker.handle} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageType}</span>.${dodged ? DODGE_BROKEN : ''}${defHpTag}`;

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
  // Cached for the mob-side flee contest: moveEntity is synchronous and can't
  // await effectiveSkill. A mob is only ever gated while a player is actively
  // attacking it, so by then this has always been stamped by a real swing.
  player._lastAttackSkill = attackSkill;
  const power = takePower(player);
  const npcDodge = npc.flags?.dodge ?? 1;
  const margin = (attackSkill + hitBonus(player) - npcDodge) + rollSwing() + await darknessHitPenalty(npc.zone_id, player);
  const hit = margin >= 0;
  setCooldown(player.id, 'attack', swingInterval(player));

  if (!hit) {
    return { success: true, hit: false, margin, npcId, power, message: playerMissLine(player, npc.name, power) };
  }

  const critical = margin >= getTunable('crit_threshold', 8);
  const damage_min = weaponStats?.damage_min || 2;
  const damage_max = weaponStats?.damage_max || 5;
  const damageType = weaponStats?.damage_type || 'kinetic';
  let damage = randInt(damage_min, damage_max);
  if (critical) damage = Math.floor(damage * getTunable('crit_multiplier', 1.5));
  if (power) damage = Math.floor(damage * POW_DAMAGE_MULT);
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
      success: true, hit: true, killed: true, critical, damage, margin, npcId, npcSpeech, power,
      message: `${playerHitLine(player, npc.name, partLabel, damage, damageType, critical, power)}. They crumple.`,
    };
  }

  const { bar, tier } = hpBar(npc.hp, npc.hp_max ?? 20);
  const hpTag = ` <span class="hpbar hp-${tier}">[${bar}]</span> <span class="hp-count">${npc.hp}/${npc.hp_max ?? 20}</span>`;
  return {
    success: true, hit: true, killed: false, critical, damage, margin, npcId, npcSpeech, power,
    npcHp: npc.hp, npcHpMax: npc.hp_max ?? 20,
    message: `${playerHitLine(player, npc.name, partLabel, damage, damageType, critical, power)}${critical ? '!' : '.'}${hpTag}`,
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
  const { dodgeTerm, dodged } = await playerDefence(player);
  const margin = (npcHit - dodgeTerm) + rollSwing() + await darknessHitPenalty(npc.zone_id);
  const hit = margin >= 0;

  if (!hit) {
    // Evading trains Dodge — the closer the call, the better you learn (abs margin).
    await awardSkillUse(player.id, 'dodge', margin);
    return { hit: false, message: dodged ? dodgedMissLine(npc.name) : `${npc.name} attacks you and misses.` };
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
      ? `<span class="crit-tag-in">CRITICAL!</span> ${npc.name} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageTypes}</span>!${dodged ? DODGE_BROKEN : ''}${selfHpTag(player.hp - damage, player.hp_max)}`
      : `${npc.name} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageTypes}</span>.${dodged ? DODGE_BROKEN : ''}${selfHpTag(player.hp - damage, player.hp_max)}`,
  };
}

// Like pvpSwing but for a sleeping/offline defender: always hits, no dodge roll.
// defender is a plain DB row (offline player); soak is 0 since it's not cached.
export async function pvpSwingSleeping(attacker, defender) {
  if ((defender.hp ?? defender.hp_max ?? 100) <= 0) return null;
  if (isOnCooldown(attacker.id, 'attack')) return null;
  // A sleeper can't dodge, so `pow` adds nothing here — but the flag is still
  // spent rather than left armed to fire on some later, unrelated swing.
  const power = takePower(attacker);
  setCooldown(attacker.id, 'attack', swingInterval(attacker));
  await ensureTunables();

  const equipped = await getEquippedWeapon(attacker);
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
  if (power) damage = Math.floor(damage * POW_DAMAGE_MULT);
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
