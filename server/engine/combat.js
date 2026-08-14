import { world, getEnemyInstance, removeEnemyInstance, getLivePlayer, getZone, getZonePlayers, getZoneEnemies, getZoneNpcs, tryBattleCry, zoneTerrain } from './world.js';
import { getNpcCombatLine } from './npc-personality.js';
import { effectiveSkill, awardSkillUse } from './skills.js';
import { ensureTunables, getTunable } from './tunables.js';
import { getZoneVisibility, lightHitPenalty } from './environment.js';
import { fireHook } from './plugins.js';
import { getZoneProtection } from './protection.js';
import { query } from '../models/db.js';
import { getEquippedWeapon } from './inventory.js';
import { wear, WEAR_EVENTS, conditionPenalty, announceWear } from './durability.js';
import { strain } from './strain.js';
import { fireDamageToPlayer, fireDamageToEnemy, dominantDamageType } from './damage-events.js';
import { BASE_ATTACK_MS, hitBonus, defenseBonus, swingInterval, consumeDodge, swingVerb, missLine } from './stance.js';
import { knockOut, isOut } from './unconscious.js';
import { applyEffect } from './effects.js';
import { sendToPlayer } from './messaging.js';
import { PART_TO_SLOT, DEFAULT_BODY_PART_WEIGHTS, partLabelOf, hitWeightsForPlayer } from './body-parts.js';
import { mutationFlag } from './mutations.js';

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

// Quoted cry  → speech:  Name says, "..."   (name prepended as speaker)
// Unquoted cry → emote:   raw text as-is    ($enemy token already substituted in)
export function formatBattleCry(name, raw) {
  return (raw.startsWith('"') && raw.endsWith('"'))
    ? `<span class="speech-line">${name} says, ${raw}</span>`
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

// ── The swing seam ───────────────────────────────────────────────────────────
//
// The one place a plugin can see a swing while it is still resolving, and bend
// it. Everything else in this file that a plugin touches is a FIELD POKE — the
// injury plugin maintains `enemy._injuryHitMod`, the weapon plugin sets
// `player._powQueued` — and that pattern is good at exactly one thing: intent
// armed somewhere else, earlier. It cannot express OBSERVATION, which is what a
// system that learns an opponent over the course of a fight needs.
//
// A REGISTRY, deliberately, and not a `gatherHook`. `gatherHook` is async: it
// awaits every handler, so one plugin doing a query inside it would put a DB
// round trip on every swing in the game. senses.js:127 made this exact call for
// the movement path — it is why `acuitySync` exists beside `acuityFor` — and
// combat is hotter than movement. A registry of plain functions cannot become a
// round trip no matter what a plugin does inside it.
//
// SYNC BY CONTRACT, and stricter than every other contributor registry here:
//
//   · may not await          (the loop ignores the promise; your work vanishes)
//   · may not query          (RAM is authoritative on this path — read the
//                             hydrated caches, never the database)
//   · may not send           (a sendToPlayer here is N websocket writes inside
//                             the tick's enemy loop; push prose into ctx.lines
//                             and the engine appends it to the message it was
//                             already sending)
//
// It runs twice per swing, in both directions. Two phases:
//
//   'pre'   before the to-hit roll — the ctx's modifier fields are read back
//   'post'  after the outcome is known, INCLUDING ON A MISS, which is the whole
//           reason this isn't built on damage-events.js: a system that reads an
//           opponent learns as much from a swing that missed as one that landed
//
const swingContributors = new Map();

export function registerSwingContributor(fn, owner = 'unknown') {
  if (typeof fn === 'function') swingContributors.set(owner, fn);
}
export function getSwingContributors() { return [...swingContributors.keys()]; }

function applySwing(phase, ctx) {
  if (!swingContributors.size) return null;
  for (const fn of swingContributors.values()) {
    try { fn(phase, ctx); } catch { /* a broken technique is not a broken swing */ }
  }
  return ctx;
}

// Build the ctx INSIDE the size test, never before it: with nothing registered
// the cost of this seam has to be one Map.size read and no allocation at all.
function beginSwing(ctx) {
  return swingContributors.size ? applySwing('pre', ctx) : null;
}
function endSwing(swing, outcome) {
  if (!swing) return;
  Object.assign(swing, outcome);
  applySwing('post', swing);
}
// Prose a contributor asked to ride this swing's message.
function swingLines(swing) {
  return swing?.lines?.length ? swing.lines.join('') : '';
}

// Test surface. The seam's whole promise is "combat is unchanged when nothing
// is registered", and that is only worth anything if it's asserted — but the
// helpers are internal so a plugin can't call them and fake a swing.
export const _swingTest = {
  begin: beginSwing,
  end: endSwing,
  lines: swingLines,
  clear: () => swingContributors.clear(),
  // Snapshot/restore so the "combat is unchanged when nothing is registered"
  // assertions can still be made in a world where real plugins have registered.
  snapshot: () => new Map(swingContributors),
  restore: (m) => { swingContributors.clear(); for (const [k, v] of m) swingContributors.set(k, v); },
};

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
  // Going straight up is the oldest way out of a fight. Applied to the flee
  // contest only, never to the dodge roll in the fight itself: wings help you
  // LEAVE, they do not make you harder to hit while you stay. That split is what
  // keeps flight a mobility mutation rather than a combat one.
  const wings = mutationFlag(player, 'flight') ? 6 : 0;
  const rating = (await effectiveSkill(player, 'dodge')) + defenseBonus(player) + wings;
  const margin = rollFleeContest(rating, attackerHit);
  await awardSkillUse(player.id, 'dodge', margin);
  return margin >= 0;
}

// The mob half. Enemies use their flat `dodge` rating (or an explicit
// flags.flee_skill override, which the old FLEE node already honoured).
// ── Stun ─────────────────────────────────────────────────────────────────────
//
// Being stunned means you cannot swing. Rather than invent a turn-skip mechanic,
// this reuses the one `dodge` already proved: lock the attack cooldown, and
// `cmdAttack` refuses with its existing "still recovering" line while every
// auto-attack loop skips on its own. No new guard in the tick.
//
// Two targets, two shapes, because a player and a mob keep their readiness in
// different places:
//   PLAYER — the cooldown map, plus a named status so it shows on the status line
//   ENEMY  — `_stunnedUntil`, checked by enemyAttackPlayer beside the isOut guard
//
// NPCs are deliberately not covered: they have no status list and no equivalent
// readiness field, so a stun would be silent. Better absent than pretend.
const STUN_MS = 4000;

export function applyStun(target, ms = STUN_MS) {
  if (!target) return false;
  if (target.instanceId) {                 // a live enemy instance
    target._stunnedUntil = Math.max(target._stunnedUntil || 0, Date.now() + ms);
    return true;
  }
  if (target.id && target.hp_max != null) { // a player
    setCooldown(target.id, 'attack', ms);
    applyEffect(target, 'stunned', Math.ceil(ms / 1000));
    return true;
  }
  return false;
}

export function isStunned(entity) {
  return !!entity?._stunnedUntil && Date.now() < entity._stunnedUntil;
}

/**
 * Roll a weapon's authored `status_chance` against whatever it just hit.
 *
 * The tag has existed on items for a long time with exactly one reader, which
 * copied it into a variable nobody consumed — so the taser's 30% stun has never
 * once fired. This is that reader.
 */
function rollWeaponStatus(weaponStats, target) {
  const table = weaponStats?.status_chance;
  if (!table || typeof table !== 'object') return null;
  for (const [effect, chance] of Object.entries(table)) {
    const p = Number(chance);
    if (!(p > 0) || Math.random() >= p) continue;
    if (effect === 'stunned') return applyStun(target) ? 'stunned' : null;
    // Anything else only lands on something with a status list — a mob has none.
    if (target?.hp_max != null && !target.instanceId) {
      applyEffect(target, effect, 20);
      return effect;
    }
  }
  return null;
}

export function mobFleeRoll(entity, attackerHit) {
  const rating = Number(entity?.flags?.flee_skill ?? entity?.dodge ?? entity?.flags?.dodge ?? 1);
  // A mob with ruined legs is worse at breaking contact. `_injuryFleeMod` is a
  // plain field the injury plugin maintains on the instance (see the aim note
  // above for why the engine reads a field rather than importing the plugin);
  // absent it, this is exactly the roll it always was.
  const hurt = Number(entity?._injuryFleeMod) || 0;
  return rollFleeContest(rating + hurt, attackerHit) >= 0;
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
function playerHitLine(player, targetName, partLabel, damage, damageType, critical, power, execution) {
  const part = `<span class="hit-part">${partLabel}</span>`;
  const dmg = `<span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageType}</span>`;
  // A called shot that lands is the rarest thing a player can do on purpose, and
  // it should never be mistaken for an ordinary crit.
  if (execution === 'kill') {
    return `<span class="crit-tag">EXECUTION</span> Your shot goes exactly where you sent it. ${targetName}'s ${part} comes apart — ${dmg}`;
  }
  if (execution === 'knockout') {
    return `<span class="crit-tag">KNOCKOUT</span> You bring it down flat on ${targetName}'s ${part}. They fold up and do not get back up`;
  }
  if (execution === 'maim') {
    return `<span class="crit-tag">CALLED SHOT</span> You put it through ${targetName}'s ${part} — ${dmg}. Not enough to finish it, but it will never be right again`;
  }
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

// Anatomy lives in server/engine/body-parts.js — one table, four former copies.
// `partLabelOf` is re-exported so every existing importer of it from this module
// keeps working; the tables themselves are read directly from the substrate.
export { partLabelOf };

// ── Wielding something you have no business wielding ─────────────────────────
//
// Top-tier weapons carry `min_skill` ({ blades: 6 }). A vendor will not SELL you
// one under that bar — see vendor.js — but nothing stops you looting one off a
// corpse, and nothing should. You just cannot use it properly.
//
// Deliberately a soft gate rather than an equip refusal: "you may not hold this"
// is a rule, whereas "you are visibly terrible with this" is a story, and it
// leaves the looted-a-great-sword-too-early moment intact instead of deleting it.
const UNDERSKILL_DAMAGE_STEP = 0.15;   // per level short
const UNDERSKILL_DAMAGE_FLOOR = 0.25;  // never worse than a quarter of the blow

export function weaponSkillRequirement(weaponStats) {
  const req = weaponStats?.min_skill;
  if (!req || typeof req !== 'object') return null;
  const [skillId, level] = Object.entries(req)[0] || [];
  const need = Number(level) || 0;
  return skillId && need > 0 ? { skillId, need } : null;
}

/** null when you are up to it, otherwise how badly you are fumbling it. */
export function underskilledPenalty(weaponStats, skill = 0) {
  const req = weaponSkillRequirement(weaponStats);
  if (!req) return null;
  const deficit = req.need - (Number(skill) || 0);
  if (deficit <= 0) return null;
  return {
    ...req,
    deficit,
    hitMod: -deficit,
    damageScale: Math.max(UNDERSKILL_DAMAGE_FLOOR, 1 - UNDERSKILL_DAMAGE_STEP * deficit),
  };
}

// ── Fighting in water ────────────────────────────────────────────────────────
//
// Read straight off the zone (same test the swimming plugin uses — terrain,
// `flags.water`, `flags.underwater`), so the engine needs no plugin import and
// this holds on every attack path including the auto-attack tick.
function isWaterZone(zone) {
  return !!zone && (zoneTerrain(zone) === 'water' || !!zone.flags?.water || !!zone.flags?.underwater);
}

// Mastery is what buys it back. Below `WATER_SKILL_FLOOR` you are flailing; by
// `WATER_SKILL_CAP` you fight in water nearly as well as out of it. A weapon
// tagged `waterproof` ignores all of this — that is the "unless designed for it".
const WATER_SKILL_FLOOR = 8;
const WATER_SKILL_CAP = 18;
const WATER_MIN_DAMAGE_SCALE = 0.15;   // almost nothing, unskilled
const WATER_MAX_SWING_PENALTY_MS = 1800;

/**
 * null when it doesn't apply, otherwise how badly water is ruining this swing.
 *
 *   { blocked }        — a firearm. Wet powder; it simply does not fire.
 *   { damageScale,     — melee. Water eats the swing: you cannot get any speed
 *     swingExtraMs }     behind a bat, and a blade has nothing to bite.
 */
// Size matters more than anything else down here. A knife is a thrust — water
// barely argues with it — whereas a big sword is a SWING, and a swing is exactly
// the motion water refuses to let you make. Weight is the proxy (grams), because
// every weapon already carries one and it needs no new authoring.
//
//   <= 1000g  a knife, a shiv          — almost unaffected
//   ~2200g    a shortsword             — awkward
//   >= 4000g  a chainblade, a sledge   — hopeless until you are very good
const WATER_LIGHT_G = 1000;
const WATER_HEAVY_G = 4000;

function waterBulk(weaponStats) {
  const g = Number(weaponStats?.weight);
  if (!(g > 0)) return 0.5;                       // unknown: treat as middling
  if (g <= WATER_LIGHT_G) return 0;
  if (g >= WATER_HEAVY_G) return 1;
  return (g - WATER_LIGHT_G) / (WATER_HEAVY_G - WATER_LIGHT_G);
}

export function waterCombatPenalty(zone, weaponStats, skill = 0) {
  if (!isWaterZone(zone)) return null;
  if (weaponStats?.waterproof) return null;

  // An electrical weapon in water works perfectly. That is the problem: the
  // water is the circuit, so it works on the whole room and on you.
  if (weaponStats?.water_shock) {
    return { blocked: false, discharge: true, damageScale: 1, swingExtraMs: 0, mastery: 1 };
  }

  const skillId = weaponStats?.weapon_skill || 'fists';
  if (skillId === 'firearms') {
    return { blocked: true, reason: 'firearm' };
  }

  const span = WATER_SKILL_CAP - WATER_SKILL_FLOOR;
  const mastery = Math.min(1, Math.max(0, ((Number(skill) || 0) - WATER_SKILL_FLOOR) / span));
  const bulk = waterBulk(weaponStats);

  // Two independent outs: be good, or carry something small. A novice with a
  // knife fights nearly normally; a master with a chainblade manages; a novice
  // with a chainblade is worse off than unarmed and should feel it.
  const relief = Math.max(mastery, 1 - bulk);
  return {
    blocked: false,
    bulk,
    damageScale: WATER_MIN_DAMAGE_SCALE + (1 - WATER_MIN_DAMAGE_SCALE) * relief,
    swingExtraMs: Math.round(WATER_MAX_SWING_PENALTY_MS * bulk * (1 - mastery)),
    mastery,
  };
}

// ── Fighting something that is off the ground ────────────────────────────────
//
// `flags.flies` has been authored since the Architect Scout Drone was written and
// read by nothing, so a drone hovering out of arm's reach was punched exactly as
// easily as a man standing in front of you. This is the reader, and it is the
// mirror image of the water rule above: water punishes the LONG weapon (a swing
// is the motion water refuses to let you make), air punishes the SHORT one (you
// simply cannot reach). Same `weight` proxy, opposite sign — no new authoring.
//
// Ranged is the intended answer. Shoot the thing down.
const FLIGHT_SKILL_FLOOR = 8;
const FLIGHT_SKILL_CAP = 20;
const FLIGHT_MAX_HIT_PENALTY = -7;   // an unskilled fist at a hovering drone
const FLIGHT_REACH_G = 3500;         // a polearm-length weapon; reaches on its own

function flightReach(weaponStats) {
  const g = Number(weaponStats?.weight);
  if (!(g > 0)) return 0;                          // unknown, and bare hands: none
  return Math.min(1, g / FLIGHT_REACH_G);
}

/**
 * null when it doesn't apply, otherwise `{ hitMod, reach, mastery }`.
 *
 * A STUNNED flier is a GROUNDED flier — the penalty lifts entirely for those few
 * seconds. That is the whole loop this is here to create: you cannot reach it, so
 * you drop it (a taser's `status_chance`, an unaimed head crit), and then you get
 * to use the weapon you actually brought. It is also why this takes the live
 * enemy instance rather than the template.
 */
export function flightCombatPenalty(enemy, weaponStats, skill = 0) {
  if (!enemy?.flags?.flies) return null;
  if (isStunned(enemy)) return null;               // knocked out of the air

  const skillId = weaponStats?.weapon_skill || 'fists';
  if (skillId === 'firearms' || skillId === 'thrown') return null;

  const span = FLIGHT_SKILL_CAP - FLIGHT_SKILL_FLOOR;
  const mastery = Math.min(1, Math.max(0, ((Number(skill) || 0) - FLIGHT_SKILL_FLOOR) / span));
  const reach = flightReach(weaponStats);
  // Two independent outs, exactly as in water: be good, or carry something that
  // gets there. Timing a swing at a hovering thing is a skill like any other.
  const relief = Math.max(mastery, reach);
  return { hitMod: Math.round(FLIGHT_MAX_HIT_PENALTY * (1 - relief)), reach, mastery };
}

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

// ── Aim: opt-in manual body targeting ────────────────────────────────────────
//
// `player._aimPart` is a plain field on the live player object, armed by the
// injury plugin's `aim` verb and consumed here. That is the same one-way shape
// `_powQueued` already uses: the engine never imports the plugin, and with
// nothing aiming the maths below is skipped entirely, so combat is unchanged for
// every player who ignores this.
//
// Aim BIASES the existing weighted roll rather than adding a second targeting
// path. A missed aim still lands somewhere, so there is no "aimed shot" branch
// to keep in sync — and a creature that has no such part simply falls through to
// its ordinary spread.
const AIM_FOCUS = 0.70;      // aimed part's share of the new weight pool
const AIM_RESIDUAL = 0.25;   // everything else keeps a quarter of its weight

// To-hit cost of aiming, in margin units (the 2d8−2d8 swing spans −14..+14, and
// an even matchup hits on 54%). Deliberately STEEP: an unskilled called shot is
// a real gamble, not a small tax.
//
//   unskilled hit chance — head 5%, feet 8%, limbs 12%, centre mass 54%
//
// Centre mass is free, and is the only free one: aiming there is what the
// weighted roll already favours, so charging for it would be charging for
// nothing.
export const AIM_PENALTY = {
  head: -8, torso: 0, feet: -7,
  left_arm: -6, right_arm: -6, left_leg: -6, right_leg: -6,
};

// Skill buys precision back — "master characters are precise, not lucky" — but
// never all of it. Every called shot bottoms out at AIM_FLOOR, so aiming is
// never strictly free and nobody can just leave it switched on.
//
// The floor is shared, which gives one legible rule: a novice pays the full
// anatomy cost, a master pays 2 for any shot they call. Head goes 5% → 38% over
// a career, so mastery is worth a great deal without ever becoming automatic.
const AIM_FLOOR = -2;

export function aimHitPenalty(player, skill = 0) {
  const part = player?._aimPart;
  if (!part) return 0;
  const base = AIM_PENALTY[part] ?? 0;
  if (base === 0) return 0;
  const relief = Math.min(Math.abs(base) + AIM_FLOOR, Math.floor((Number(skill) || 0) / 2));
  return base + relief;
}

// Bias a weight map toward the aimed part. Returns the map unchanged when the
// player is not aiming, or when the target has no such part to aim at.
// Exported for the regress suite — the identity-on-no-aim property is the one
// that guarantees this feature is free for players who ignore it.
export function aimedWeights(player, base) {
  const part = player?._aimPart;
  if (!part) return base;
  // `base` is null for anything using the global spread (players, and mobs with
  // no authored body_parts). Resolve it here rather than returning null, or aim
  // would silently do nothing against the majority of targets in the game.
  const src = base || getTunable('body_part_weights', DEFAULT_BODY_PART_WEIGHTS);
  if (!(part in src)) return base;          // this creature has no such part
  const total = Object.values(src).reduce((s, v) => s + (Number(v) || 0), 0);
  if (!(total > 0)) return base;
  const out = {};
  for (const k of Object.keys(src)) out[k] = (Number(src[k]) || 0) * AIM_RESIDUAL;
  out[part] = total * AIM_FOCUS;
  return out;
}

// ── Buckshot: one blast, several impacts ─────────────────────────────────────
//
// A weapon tagged `spread: N` lands as N separate pellet groups instead of one
// slug. Each group rolls its OWN body part and is soaked SEPARATELY against the
// armour covering it, then the whole lot is summed for HP.
//
// This exists because a single 18–34 roll against a 40 HP body saturated the
// injury curve: it cleared the Maimed bar on essentially every hit, at every
// armour tier, so armour stopped mattering and the three-severity ladder
// collapsed to one rung. Splitting the same damage produces several ordinary
// wounds rather than one guaranteed catastrophe, which is both what buckshot
// actually does and what the injury system can model.
//
// The knock-on is the point: per-group soak means armour is MUCH better against
// a shotgun than against a slug, because it subtracts once per pellet group.
// That is the mechanic doing its job — it hands armour back the relevance the
// single-roll version took away.
const MAX_SPREAD = 4;

export function spreadGroups(weaponStats) {
  const n = Math.floor(Number(weaponStats?.spread) || 1);
  return Math.max(1, Math.min(MAX_SPREAD, n));
}

// Split a damage total into `groups` near-even shares. Remainder goes to the
// earliest groups, so a 3-way split of 10 is 4/3/3 and never 3/3/3-and-lose-1.
export function splitSpread(total, groups) {
  if (groups <= 1) return [total];
  const base = Math.floor(total / groups);
  const rem = total - base * groups;
  const out = [];
  for (let i = 0; i < groups; i++) {
    const share = base + (i < rem ? 1 : 0);
    if (share > 0) out.push(share);
  }
  return out.length ? out : [total];
}

// ── The execution shot ───────────────────────────────────────────────────────
//
// A called head shot that finds its mark can kill outright. Three conditions,
// all of which the attacker had to choose or earn:
//
//   1. they DELIBERATELY aimed at the head (`_aimPart === 'head'`)
//   2. the blow actually landed on the head
//   3. it was a critical
//
// The rarity is emergent, not a hidden dice roll. Aiming high costs −8 to hit,
// so a novice's margin **cannot arithmetically reach** the +8 crit threshold —
// this is 0% until you train, not merely unlikely. Measured per swing: skill 1–3
// is 0.0%, skill 6 is 3.9% against a weak mob, skill 15 is 62.8% against a weak
// mob and 12.8% against an elite. Mastery is the whole gate.
//
// Because enemies never set `_aimPart`, a mob can NEVER execute a player. This
// is always something a player chose to do, never something that happens to
// them — the same principle the stealth system uses for knockouts.
const EXECUTION_MIN_FRACTION = 0.25;

// Blunt and unarmed take a skull without opening it. This is the stealth
// system's rule verbatim (systems-stealth.md): "swinging a blade at a skull is
// not a knockout attempt however quietly you crept up, it is a killing." Reusing
// it means the two ways to knock somebody out agree, and it needs no new verb —
// you chose this outcome when you picked up a bat instead of a knife.
const KO_SKILLS = new Set(['clubs', 'fists']);

/**
 * 'kill' | 'knockout' | 'maim' | null.
 *
 * The damage floor is what stops "one hit" meaning "one hit on anything": the
 * blow must be worth a quarter of the target's max HP AFTER soak, so a 600 HP
 * boss would need 150 damage in a single strike and simply cannot be cheesed.
 * It also hands the `head` armour slot a real job — a helmet that soaks enough
 * pushes the attacker under the floor, which is the counterplay.
 *
 * Falling short is not nothing: a called crit to an armoured skull still ruins
 * it. That keeps the shot worth attempting against big targets.
 *
 * The knockout branch does NOT violate "combat is to the death, and stays that
 * way" — that rule forbids a RANDOM knockout mid-fight, for two stated reasons.
 * Neither applies here: this is never random (it needs a deliberate called shot
 * AND a blunt weapon, both chosen in advance), and the invisibility problem is
 * solved separately by disengaging the attacker and teaching the auto-attack
 * loops to leave an unconscious body alone.
 */
export function executionShot(attacker, { part, damage, critical, targetHpMax, weaponSkill }) {
  if (part !== 'head' || !critical) return null;
  if (attacker?._aimPart !== 'head') return null;
  const frac = damage / Math.max(1, Number(targetHpMax) || 1);
  if (frac < EXECUTION_MIN_FRACTION) return 'maim';
  return KO_SKILLS.has(weaponSkill) ? 'knockout' : 'kill';
}

// Weighted pick of a struck body part. Pass explicit weights (e.g. a monster's
// per-part hit %) or fall back to the global tunable default (~torso-heavy).
//
// When the TARGET is a player, callers pass `targetWeights(player)` rather than
// nothing — a body that has grown something can be struck on it. That helper
// returns the tunable default unchanged for anyone who hasn't, so this stays
// exactly as it was for every ordinary body.
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

// The struck-part weights for a specific player target. Identity on the tunable
// default for anyone carrying no part-granting mutation, which is what makes
// this free to call from every player-target swing.
function targetWeights(player) {
  return hitWeightsForPlayer(player, getTunable('body_part_weights', DEFAULT_BODY_PART_WEIGHTS));
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
  // Strain fires FIRST, and unconditionally — before the row check. Chrome under
  // the skin is worked by taking the blow whether or not there was armour over it
  // to wear out, so an unarmoured player's implants still heat. Sync by contract
  // (server/engine/strain.js); it never awaits and never queries.
  strain(player, 'taken');
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
  // Same rule as wearStruckArmor: an unarmed swing has no row to wear but a
  // hydraulic arm still did the work, so strain is unconditional.
  strain(player, 'swing');
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
    // A body part may OWN a damage component (body_parts[].grants.component).
    // Ruin every part that grants it and that component stops firing — the arc
    // goes out, the bite stops. `_lostComponents` is maintained by the injury
    // plugin; absent it, this is exactly the list it always was.
    const lost = enemy._lostComponents;
    const live = lost
      ? enemy.weapon.filter((_, i) => !lost.has(i))
      : enemy.weapon;
    // Never leave a creature with NO attack at all — something that cannot
    // strike is a corpse that hasn't been told, and it would stand there being
    // hit forever. The last component always survives.
    const use = live.length ? live : [enemy.weapon[enemy.weapon.length - 1]];
    return use.map(c => ({
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

  // Water ruins a fight. A firearm does not fire at all; everything else swings
  // slow and lands soft until you are genuinely good at this.
  const water = waterCombatPenalty(getZone(player.current_zone), weaponStats, attackSkill);
  if (water?.blocked) {
    return { success: false, message: 'Your weapon is full of water. It coughs, and does nothing at all.' };
  }

  const power = takePower(player);
  // Ruined fins, wings or legs cost a creature its evasion — the injury plugin
  // maintains `_injuryDodgeMod` from `grants.dodge` on the parts that provide it.
  // Floored at 0: a wrecked thing is easy to hit, never impossible to miss.
  const enemyDodge = Math.max(0, (enemy.dodge ?? 1) + (Number(enemy._injuryDodgeMod) || 0));
  // Calling your shot costs accuracy, and skill buys most of it back.
  const aimCost = aimHitPenalty(player, attackSkill);
  // A weapon well above your grade swings wide as well as soft.
  const unskilled = underskilledPenalty(weaponStats, attackSkill);
  // It is in the air and you are not. Ranged ignores this; so does a stunned
  // flier, because a stunned flier is on the floor.
  const flight = flightCombatPenalty(enemy, weaponStats, attackSkill);
  const swing = beginSwing({
    kind: 'outgoing', player, enemy, weaponStats, attackSkill, power, enemyDodge,
    hitMod: 0, damageScale: 1, critBonus: 0, lines: [],
  });
  const margin = (attackSkill + hitBonus(player) - enemyDodge) + aimCost + (unskilled?.hitMod || 0)
    + (flight?.hitMod || 0) + (swing?.hitMod || 0) + rollSwing() + await darknessHitPenalty(enemy.zoneId, player);
  const hit = margin >= 0;

  // Water drags the swing out on top of the stance interval.
  setCooldown(player.id, 'attack', swingInterval(player) + (water?.swingExtraMs || 0));

  if (!hit) {
    // Closed out HERE and not below, so a miss still reaches 'post': a swing
    // that missed taught you as much about the thing as one that landed. The
    // hit branch closes its own after the damage is known.
    endSwing(swing, { hit, margin });
    return {
      success: true,
      hit: false,
      margin,
      power,
      // Say WHY, or a run of misses reads as bad luck instead of a wrong tool.
      message: playerMissLine(player, enemy.name, power)
        + (flight?.hitMod < 0 ? ` <span class="dmg-type">It is above you. You need reach, or something that shoots.</span>` : '')
        + swingLines(swing),
      enemyId: enemyInstanceId,
      enemyHp: enemy.hp,
      enemyHpMax: enemy.hp_max,
    };
  }

  wearHeldWeapon(player);   // the swing landed — the weapon that landed it wears
  const critThreshold = getTunable('crit_threshold', 8);
  const critMultiplier = getTunable('crit_multiplier', 1.5);
  const critical = margin >= (critThreshold - (swing?.critBonus || 0));

  const damage_min = weaponStats?.damage_min || 2;
  const damage_max = weaponStats?.damage_max || 5;
  const damageType = weaponStats?.damage_type || 'kinetic';
  let damage = randInt(damage_min, damage_max);
  damage = Math.max(1, Math.round(damage * weaponScale(player)));
  // Water eats the blow before it lands — you cannot get speed behind a bat and
  // a blade has nothing to bite. Applied to the ROLL, before crit and the head
  // multiplier, so a critical underwater is still a bad critical.
  if (unskilled) damage = Math.max(1, Math.round(damage * unskilled.damageScale));
  if (water) damage = Math.max(1, Math.round(damage * water.damageScale));
  if (critical) damage = Math.floor(damage * critMultiplier);
  if (power) damage = Math.floor(damage * POW_DAMAGE_MULT);
  if (swing && swing.damageScale !== 1) damage = Math.max(1, Math.round(damage * swing.damageScale));

  // Buckshot lands as several impacts; everything else is a single one, which
  // is the same code path with a one-element list.
  const groups = spreadGroups(weaponStats);
  const headMultiplier = getTunable('head_damage_multiplier', 1.5);
  const weights = enemyBodyPartWeights(enemy);
  const impacts = [];
  let landedTotal = 0;

  for (const share of splitSpread(damage, groups)) {
    const p = rollBodyPart(aimedWeights(player, weights));
    let amt = share;
    if (p === 'head') amt = Math.floor(amt * headMultiplier);
    const soak = enemyPartSoak(enemy, p, damageType);
    // A single-impact weapon always does at least 1 (unchanged). A pellet group
    // may be stopped outright — that is what makes armour meaningful against a
    // spread weapon — but the blast as a whole still floors at 1 below.
    const landed = Math.max(groups > 1 ? 0 : 1, amt - soak);
    landedTotal += landed;
    impacts.push({ part: p, damage: landed, baseDamage: Math.max(0, share - soak) });
  }

  damage = Math.max(1, landedTotal);
  const part = impacts[0].part;
  const partLabel = impacts.length > 1
    ? impacts.map(i => partLabelOf(i.part)).filter((v, i, a) => a.indexOf(v) === i).join(' and ')
    : (partLabelOf(part));

  // A called head shot. With a spread weapon the heaviest pellet group in the
  // skull is the one that decides it.
  const headImpact = impacts.filter(i => i.part === 'head').sort((a, b) => b.damage - a.damage)[0];
  const execution = headImpact
    ? executionShot(player, {
        part: 'head', damage: headImpact.damage, critical,
        targetHpMax: enemy.hp_max, weaponSkill: weaponSkillId,
      })
    : null;
  if (execution === 'kill') damage = Math.max(damage, enemy.hp);
  if (execution === 'knockout') {
    // HP is pinned at 1, never 0 — an enemy at zero is simply dead, so a
    // knockout that killed would be a killing with extra steps. Same pin the
    // sneak plugin uses.
    damage = Math.max(0, Math.min(damage, (enemy.hp ?? enemy.hp_max) - 1));
    knockOut(enemy, { by: player.id });
    // Disengage, or the 1s auto-attack loop finishes the body next tick and
    // nobody ever sees the knockout happen. This is reason (1) the stealth doc
    // gives for banning random mid-fight KOs; a deliberate one has to answer it.
    player.combatTargetId = null;
    enemy.targetId = null;
  }

  // §8b — the enemy gets wounded too. In-memory on the instance, so it dies with
  // the mob and costs nothing to store. Fired BEFORE the kill check so the last
  // blow still reads as a wound to anything watching. One event PER IMPACT, so a
  // shotgun spreads several ordinary wounds instead of one catastrophic one.
  for (const im of impacts) {
    if (im.damage <= 0) continue;
    fireDamageToEnemy(enemy, {
      part: im.part, damage: im.damage, baseDamage: im.baseDamage,
      type: damageType, critical, source: 'player', attacker: player,
      // A called crit that couldn't kill still ruins the skull.
      forceSeverity: (execution === 'maim' && im === headImpact) ? 3 : undefined,
    });
  }

  // A `water_shock` weapon fired in water earths through everything present —
  // every other player and every other enemy in the zone, and the idiot holding
  // it. Resolved here rather than in a plugin because it is the same blow, not a
  // second attack: no extra cooldown, no second to-hit roll.
  if (water?.discharge) {
    const jolt = Math.max(1, Math.round(damage * 0.6));
    for (const other of getZoneEnemies(player.current_zone) || []) {
      if (other.instanceId === enemy.instanceId) continue;
      other.hp -= jolt;
      other.targetId = player.id;
    }
    for (const bystander of getZonePlayers(player.current_zone) || []) {
      const live = getLivePlayer(bystander.id) || bystander;
      if (!live || live.hp == null) continue;
      live.hp = Math.max(1, live.hp - jolt);   // humiliating, never lethal
      live._resDirty = true;
      if (live.id !== player.id) {
        sendToPlayer(live.id, { type: 'output', message: `The water lights up. <span class="dmg-taken">${jolt}</span> — you are standing in it too.` });
      }
    }
    player.hp = Math.max(1, (player.hp ?? player.hp_max) - jolt);
    player._resDirty = true;
  }

  // The weapon's authored status_chance, finally read. A taser that stuns is the
  // whole reason that tag was ever written down.
  let statusHit = rollWeaponStatus(weaponStats, enemy);

  // HEAD CRIT → STUN, as the consolation for a crit that landed on the skull by
  // luck rather than design. Deliberately gated to an UNAIMED crit: a called
  // head shot already pays out as an execution or a knockout, and stacking a
  // stun on top would be two rewards for one event. So aiming buys the bigger
  // outcome, and not aiming still makes a lucky head crit worth something.
  if (!statusHit && execution === null && part === 'head' && critical && player._aimPart !== 'head') {
    if (applyStun(enemy)) statusHit = 'stunned';
  }

  enemy.hp -= damage;
  enemy.targetId = player.id;

  // The hit branch's single 'post', with the outcome complete.
  endSwing(swing, { hit, margin, damage, impacts, critical, part, killed: enemy.hp <= 0 });

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
      message: `${playerHitLine(player, enemy.name, partLabel, damage, damageType, critical, power, execution)}. ${enemy.death_message}${swingLines(swing)}`,
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
    message: `${playerHitLine(player, enemy.name, partLabel, damage, damageType, critical, power, execution)}${critical ? '!' : '.'}${statusHit === 'stunned' ? (enemy.flags?.flies ? ' <span class="crit-tag">GROUNDED</span>' : ' <span class="crit-tag">STUNNED</span>') : ''}${enemyHpTag(enemy)}${swingLines(swing)}`,
    enemyId: enemyInstanceId,
    enemyHp: enemy.hp,
    enemyHpMax: enemy.hp_max,
  };
}

// Enemy attacks player — returns damage result (async: needs effectiveSkill for player dodge)
export async function enemyAttackPlayer(enemy, player) {
  // An unconscious thing does not swing. Without this a knocked-out mob keeps
  // fighting, which makes the knockout meaningless and reads as a bug.
  if (isOut(enemy)) return null;
  // A stunned mob does not swing either. Same reasoning as isOut above.
  if (isStunned(enemy)) return null;
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

  // Wounded arms degrade a mob's swing exactly as they degrade a player's — the
  // half of §8b that makes aiming at a limb a TACTIC rather than just flavour.
  const enemyHit = (enemy.hit ?? 1) + (Number(enemy._injuryHitMod) || 0);
  const { dodgeTerm, dodged } = await playerDefence(player);
  const swing = beginSwing({
    kind: 'incoming', player, enemy, enemyHit, dodgeTerm, dodged,
    hitMod: 0, soakBonus: 0, negate: false, negateLine: null, lines: [],
  });
  const margin = (enemyHit - dodgeTerm + (swing?.hitMod || 0)) + rollSwing() + await darknessHitPenalty(enemy.zoneId);
  // `negate` is a STATED OUTCOME, and deliberately not just a big negative
  // hitMod. A technique that steps inside the arc has already made its roll, in
  // the plugin, before it set this — expressing it as a to-hit penalty would let
  // it silently fail against a high-`hit` enemy, which is the exact opposite of
  // what a technique like that is for.
  const hit = margin >= 0 && !swing?.negate;

  const cries = enemy.flags?.battle_cries;
  const cry = (isFirstStrike && Array.isArray(cries) && cries.length && tryBattleCry(enemy.templateId, enemy.zoneId))
    ? formatBattleCry(enemy.name, cries[Math.floor(Math.random() * cries.length)].replace(/\$enemy/g, enemy.name).replace(/\$player/g, player.handle)) + '\n'
    : '';

  if (!hit) {
    // Evading trains Dodge — the closer the call, the better you learn (abs margin).
    await awardSkillUse(player.id, 'dodge', margin);
    endSwing(swing, { hit, margin, damage: 0 });
    // A negated swing prints the technique's OWN line. Falling through to the
    // ordinary miss text would read as luck, and the whole point of stepping
    // inside a strike is that it wasn't.
    const missLine = swing?.negateLine
      || (dodged ? dodgedMissLine(enemy.name) : `${enemy.name} attacks you and misses.`);
    return { hit: false, message: `${cry}${missLine}${swingLines(swing)}` };
  }

  const critThreshold = getTunable('crit_threshold', 8);
  const critMultiplier = getTunable('crit_multiplier', 1.5);
  const critical = margin >= critThreshold;

  // Multi-component attack: roll each typed component, soak it against the
  // struck part's matching armor type, then sum. Crit and head bonuses apply
  // to every component before its own soak.
  const components = enemyWeaponComponents(enemy);
  const damageTypes = [...new Set(components.map(c => c.type))].join('/');
  // Buckshot on the enemy side. Enemies carry a component list rather than item
  // tags, so the authoring surface is `flags.spread` on the enemy rather than a
  // weapon tag — same mechanic, same helper, different place to write it down.
  const groups = spreadGroups({ spread: enemy.flags?.spread });
  // Each component is rolled ONCE and its damage split across the groups, rather
  // than re-rolled per group — otherwise a spread weapon would quietly deal more
  // total damage than the same weapon firing a slug.
  const rolls = components.map(c => ({ c, shares: splitSpread(randInt(c.min, c.max), groups) }));

  // The old TODO here wanted head-crit-to-stun "once a turn-skip mechanic
  // exists". It exists now (applyStun) — and it is deliberately NOT used on this
  // path. This is the ENEMY hitting the PLAYER, and a mob stunning you is the
  // same agency theft the knockout rules already refuse: combat is to the death,
  // and nothing a mob rolls should take your turn away. Head crits still hurt
  // more here (head_damage_multiplier) and still wound harder. The stun lives on
  // the player's own swing instead — see playerAttackEnemy.
  let total = 0;
  let baseTotal = 0;
  const impacts = [];

  for (let g = 0; g < groups; g++) {
    const p = rollBodyPart(targetWeights(player));
    const hm = p === 'head' ? getTunable('head_damage_multiplier', 1.5) : 1;
    // Post-soak contribution per component, so the damage-events seam can name
    // the type that actually did the work rather than whichever was listed first.
    const contributions = [];
    let gTotal = 0;
    let gBase = 0;

    for (const { c, shares } of rolls) {
      const raw = shares[g] ?? 0;
      if (raw <= 0) continue;
      let amt = raw;
      if (critical) amt = Math.floor(amt * critMultiplier);
      amt = Math.floor(amt * hm);
      // A braced body is read HERE, at the moment the blow lands, rather than
      // baked into player.soak. `player.soak` is a cache rebuilt on equip and
      // login; a timed stance written into it would need invalidating on every
      // path that can end one, and a single missed path leaves a player armoured
      // forever — the worst failure available to a system whose whole premise is
      // that it grants no permanent passive.
      const soaked = playerPartSoak(player, p, c.type) + (swing?.soakBonus || 0);
      const landed = Math.max(0, amt - soaked);
      contributions.push({ type: c.type, amount: landed });
      gTotal += landed;
      // The same roll, soaked, WITHOUT the crit and head multipliers — what the
      // injury seam scores. Crit and a head hit already express themselves as
      // threshold modifiers there, and letting them also inflate the measured
      // damage made both count twice (see injury-system.md §11).
      gBase += Math.max(0, raw - soaked);
    }

    wearStruckArmor(player, p);
    total += gTotal;
    baseTotal += gBase;
    impacts.push({ part: p, damage: gTotal, baseDamage: gBase, type: dominantDamageType(contributions) });
  }

  const damage = Math.max(1, total);
  endSwing(swing, { hit, margin, damage, impacts, critical });
  for (const im of impacts) {
    if (im.damage <= 0) continue;
    fireDamageToPlayer(player, {
      part: im.part, damage: im.damage, baseDamage: im.baseDamage,
      type: im.type, critical, source: 'enemy',
    });
  }

  // A RADIATING creature dopes you just by getting close enough to land a blow.
  // `flags.radiates` + `flags.radiation_damage` have been authored on the Rad
  // Mutant and the Redline horror since before anything read them; this is that
  // reader. It costs nothing new — `player.radiation` and the `irradiated`
  // status effect both already exist — and it gives those two a real identity:
  // you can win the fight and still walk away carrying something.
  let radDose = 0;
  if (enemy.flags?.radiates) {
    radDose = Math.max(1, Number(enemy.flags.radiation_damage) || 1);
    player.radiation = Math.min(100, (player.radiation || 0) + radDose);
    player._resDirty = true;
  }

  const part = impacts[0].part;
  const partLabel = impacts.length > 1
    ? impacts.map(i => partLabelOf(i.part)).filter((v, i, a) => a.indexOf(v) === i).join(' and ')
    : (partLabelOf(part));
  // player.hp is still pre-damage here; gameLoop decrements it after this
  // returns, so the bar reflects the same value the client receives as `hp`.
  const selfHp = selfHpTag(player.hp - damage, player.hp_max);
  // Said out loud, or it is a number moving on a screen nobody has open.
  const radTag = radDose
    ? ` <span class="dmg-type">The air around it is wrong. (+${radDose} rad)</span>`
    : '';

  return {
    hit: true,
    damage,
    critical,
    message: critical
      ? `${cry}<span class="crit-tag-in">CRITICAL!</span> ${enemy.name} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageTypes}</span>!${dodged ? DODGE_BROKEN : ''}${radTag}${selfHp}`
      : `${cry}${enemy.name} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageTypes}</span>.${dodged ? DODGE_BROKEN : ''}${radTag}${selfHp}${swingLines(swing)}`,
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
  const part = rollBodyPart(targetWeights(player));
  const raw = randInt(min, max);
  const soaked = playerPartSoak(player, part, damageType);
  let damage = raw;
  if (part === 'head') damage = Math.floor(damage * getTunable('head_damage_multiplier', 1.5));
  damage = Math.max(1, damage - soaked);
  wearStruckArmor(player, part);
  fireDamageToPlayer(player, {
    part, damage, baseDamage: Math.max(1, raw - soaked),
    type: damageType, critical: false, source: 'strike',
  });
  const before = player.hp ?? player.hp_max ?? 100;
  player.hp = Math.max(0, before - damage);
  player._resDirty = true; // coalesced into the 1s flushDirtyResources write
  return { damage, part, partLabel: partLabelOf(part), killed: player.hp <= 0 };
}

/**
 * The enemy-side mirror of applyStrikeToPlayer: a source of damage that is not a
 * swing. No hit roll, no cooldown, no weapon — an electrical discharge or a
 * sonic burst does not miss, it simply happens to everything nearby.
 *
 * Exists so a plugin never has to write `enemy.hp -=` itself. Doing that by hand
 * skips the part roll, the typed soak, the damage observers that injury hangs
 * off, and the loot/removal path on death, and every one of those omissions is a
 * bug that only shows up much later.
 *
 * Lethal outcomes ARE handled here (loot + instance removal), because unlike a
 * player death there is no respawn story for the caller to own.
 */
export async function applyStrikeToEnemy(player, enemy, { min, max, damageType = 'kinetic' }) {
  await ensureTunables();
  if (!enemy || enemy.hp <= 0) return null;

  const part = rollBodyPart(enemyBodyPartWeights(enemy));
  const raw = randInt(min, max);
  const soaked = enemyPartSoak(enemy, part, damageType);
  let damage = raw;
  if (part === 'head') damage = Math.floor(damage * getTunable('head_damage_multiplier', 1.5));
  damage = Math.max(1, damage - soaked);

  fireDamageToEnemy(enemy, {
    part, damage, baseDamage: Math.max(1, raw - soaked),
    type: damageType, critical: false, source: 'strike',
  });

  enemy.hp -= damage;
  enemy.targetId = player?.id || enemy.targetId;

  if (enemy.hp <= 0) {
    if (player) {
      player.mob_kills = (player.mob_kills || 0) + 1;
      query('UPDATE players SET mob_kills=mob_kills+1 WHERE id=$1', [player.id]).catch(() => {});
    }
    const loot = resolveEnemyLoot(enemy);
    removeEnemyInstance(enemy.instanceId);
    return { damage, part, partLabel: partLabelOf(part), killed: true, loot, enemyId: enemy.instanceId };
  }
  return { damage, part, partLabel: partLabelOf(part), killed: false };
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
  // Aiming costs the same in PvP as it does against a mob. Without this the
  // penalty applied only to `playerAttackEnemy`, so calling a head shot at
  // another player was free — all of the payoff, none of the price.
  const aimCost = aimHitPenalty(attacker, attackSkill);
  const margin = (attackSkill + hitBonus(attacker) - dodgeTerm) + aimCost + rollSwing() + await darknessHitPenalty(attacker.current_zone, attacker);
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

  const critical = margin >= getTunable('crit_threshold', 8);
  const part = rollBodyPart(aimedWeights(attacker, targetWeights(defender)));

  const rawRoll = Math.max(1, Math.round(randInt(damage_min, damage_max) * weaponScale(attacker)));
  let damage = rawRoll;
  if (critical) damage = Math.floor(damage * getTunable('crit_multiplier', 1.5));
  if (power) damage = Math.floor(damage * POW_DAMAGE_MULT);

  // `pow` is a deliberate act and DOES feed the injury check — aiming a haymaker
  // at a knee should break it. Only the incidental multipliers (crit, head) are
  // withheld, because those already move the threshold.
  const pvpBase = power ? Math.floor(rawRoll * POW_DAMAGE_MULT) : rawRoll;

  // Buckshot spreads across the defender exactly as it does across a mob.
  const groups = spreadGroups({ spread: equipped?.tags?.spread });
  const headMultiplier = getTunable('head_damage_multiplier', 1.5);
  const impacts = [];
  let landedTotal = 0;
  const baseShares = splitSpread(pvpBase, groups);

  splitSpread(damage, groups).forEach((share, i) => {
    const p = groups > 1 ? rollBodyPart(aimedWeights(attacker, targetWeights(defender))) : part;
    let amt = share;
    if (p === 'head') amt = Math.floor(amt * headMultiplier);
    const soak = playerPartSoak(defender, p, damageType);
    const landed = Math.max(groups > 1 ? 0 : 1, amt - soak);
    landedTotal += landed;
    impacts.push({ part: p, damage: landed, baseDamage: Math.max(0, (baseShares[i] ?? 0) - soak) });
    wearStruckArmor(defender, p);
  });

  damage = Math.max(1, landedTotal);
  const partLabel = impacts.length > 1
    ? impacts.map(i => partLabelOf(i.part)).filter((v, i, a) => a.indexOf(v) === i).join(' and ')
    : (partLabelOf(part));

  // Executions are symmetric — a called head shot kills a player exactly as it
  // kills a mob. This is what makes a helmet worth wearing in PvP: head soak is
  // the only thing that pushes an attacker under the damage floor.
  const defHpMaxForExec = defender.hp_max ?? 100;
  const headImpact = impacts.filter(i => i.part === 'head').sort((a, b) => b.damage - a.damage)[0];
  const execution = headImpact
    ? executionShot(attacker, {
        part: 'head', damage: headImpact.damage, critical,
        targetHpMax: defHpMaxForExec, weaponSkill,
      })
    : null;
  if (execution === 'kill') damage = Math.max(damage, defender.hp ?? defHpMaxForExec);
  if (execution === 'knockout') {
    damage = Math.max(0, Math.min(damage, (defender.hp ?? defHpMaxForExec) - 1));
    knockOut(defender, { by: attacker.id });
    // Same disengage as the mob path — taking someone alive has to survive the
    // next tick, and finishing them must stay a thing you choose to type.
    attacker.pvpTargetId = null;
    attacker.combatTargetId = null;
  }

  for (const im of impacts) {
    if (im.damage <= 0) continue;
    fireDamageToPlayer(defender, {
      part: im.part, damage: im.damage, baseDamage: im.baseDamage,
      type: damageType, critical, source: 'pvp',
      forceSeverity: (execution === 'maim' && im === headImpact) ? 3 : undefined,
    });
  }
  // Same roll against a player. A stun here locks their attack cooldown, which
  // every path already respects — so it works in PvP with no new guard.
  rollWeaponStatus({ status_chance: equipped?.tags?.status_chance }, defender);
  wearHeldWeapon(attacker);

  const defHpBefore = defender.hp ?? defender.hp_max ?? 100;
  defender.hp = Math.max(0, defHpBefore - damage);
  const defHpMax = defender.hp_max ?? 100;
  defender._resDirty = true; // coalesced into the 1s flushDirtyResources write

  const killed = defender.hp <= 0;
  const defHpTag = killed ? '' : selfHpTag(defender.hp, defHpMax);

  const attackerMsg = `${playerHitLine(attacker, defender.handle, partLabel, damage, damageType, critical, power, execution)}${critical ? '!' : '.'}`;
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
  // Aim costs the same here as everywhere else. Without this the penalty applied
  // to mobs and players but not NPCs, so `aim head` was free against a person.
  const aimCost = aimHitPenalty(player, attackSkill);
  const margin = (attackSkill + hitBonus(player) - npcDodge) + aimCost + rollSwing() + await darknessHitPenalty(npc.zone_id, player);
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
  const part = rollBodyPart(aimedWeights(player, null));
  if (part === 'head') damage = Math.floor(damage * getTunable('head_damage_multiplier', 1.5));
  damage = Math.max(1, damage);
  const partLabel = partLabelOf(part);

  // NPCs have no typed soak, so a called head crit here is measured against the
  // raw blow. Same rule, same floor.
  const npcHpMax = npc.hp_max ?? 20;
  const execution = executionShot(player, {
    part, damage, critical, targetHpMax: npcHpMax, weaponSkill: weaponSkillId,
  });
  if (execution === 'kill') damage = Math.max(damage, npc.hp ?? npcHpMax);
  if (execution === 'knockout') {
    // NPC death is `hp <= 0`, so the pin at 1 is load-bearing here, not cosmetic.
    damage = Math.max(0, Math.min(damage, (npc.hp ?? npcHpMax) - 1));
    knockOut(npc, { by: player.id });
    player.combatTargetId = null;
    npc._combatTargetId = null;
  }

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
      message: `${playerHitLine(player, npc.name, partLabel, damage, damageType, critical, power, execution)}. They crumple.`,
    };
  }

  const { bar, tier } = hpBar(npc.hp, npc.hp_max ?? 20);
  const hpTag = ` <span class="hpbar hp-${tier}">[${bar}]</span> <span class="hp-count">${npc.hp}/${npc.hp_max ?? 20}</span>`;
  return {
    success: true, hit: true, killed: false, critical, damage, margin, npcId, npcSpeech, power,
    npcHp: npc.hp, npcHpMax: npc.hp_max ?? 20,
    message: `${playerHitLine(player, npc.name, partLabel, damage, damageType, critical, power, execution)}${critical ? '!' : '.'}${hpTag}`,
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
  const partLabel = partLabelOf(part);

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
  const partLabel = partLabelOf(part);

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
  const part = rollBodyPart(targetWeights(player));
  const headMult = part === 'head' ? getTunable('head_damage_multiplier', 1.5) : 1;
  let total = 0;
  for (const c of weaponArr) {
    let amt = randInt(Number(c.min) || 1, Number(c.max) || 3);
    if (critical) amt = Math.floor(amt * getTunable('crit_multiplier', 1.5));
    total += Math.max(0, Math.floor(amt * headMult) - playerPartSoak(player, part, c.type));
  }
  const damage = Math.max(1, total);
  const partLabel = partLabelOf(part);

  return {
    hit: true, damage, critical,
    message: critical
      ? `<span class="crit-tag-in">CRITICAL!</span> ${npc.name} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageTypes}</span>!${dodged ? DODGE_BROKEN : ''}${selfHpTag(player.hp - damage, player.hp_max)}`
      : `${npc.name} hits your <span class="hit-part">${partLabel}</span> for <span class="dmg-taken">${damage}</span> <span class="dmg-type">${damageTypes}</span>.${dodged ? DODGE_BROKEN : ''}${selfHpTag(player.hp - damage, player.hp_max)}`,
  };
}

// NPC swings at another NPC. The missing corner of the matrix: enemy→player,
// enemy→npc, enemy→enemy and npc→player all existed; two NPCs could never fight
// each other, so a bar brawl had to be faked with flavour text and direct HP.
//
// Deliberately built from `npcAttackPlayer`'s numbers (flags.hit, flags.weapon,
// the same crit threshold and body-part roll) rather than a new formula, so a
// given NPC hits exactly as hard whoever they swing at. The defender side is
// modelled on `enemyAttackNpc`: NPCs have `flags.dodge` and no typed soak, so
// there is no armour lookup to do.
//
// LETHAL BY DEFAULT, like every other swing in this file. Callers that want a
// scuffle rather than a killing pass `{ floorHp }` — damage then stops at that
// floor and `killed` can never come back true. That keeps "two drunks scrapping"
// and "an NPC murdering another NPC" as the same code path with one honest knob,
// instead of two systems that drift.
export async function npcAttackNpc(attacker, defender, { floorHp = 0 } = {}) {
  if (!attacker || !defender || attacker._dead || defender._dead) return null;
  if (attacker.id === defender.id) return null;
  if (getZoneProtection(defender.zone_id)) return null;   // forcefield stops this too
  const now = Date.now();
  await ensureTunables();
  const attackInterval = getTunable('enemy_attack_interval_ms', 4000);
  if (now - (attacker._lastAttack || 0) < attackInterval) return null;
  attacker._lastAttack = now;

  const margin = ((attacker.flags?.hit ?? 1) - (defender.flags?.dodge ?? 1))
    + rollSwing() + await darknessHitPenalty(defender.zone_id);
  if (margin < 0) {
    return { hit: false, killed: false, npcId: defender.id,
      message: `${attacker.name} swings at ${defender.name} and misses.` };
  }

  const critical = margin >= getTunable('crit_threshold', 8);
  const weaponArr = Array.isArray(attacker.flags?.weapon) && attacker.flags.weapon.length
    ? attacker.flags.weapon
    : [{ type: 'kinetic', min: 1, max: 3 }];
  const damageTypes = [...new Set(weaponArr.map(c => c.type))].join('/');
  const part = rollBodyPart();
  const headMult = part === 'head' ? getTunable('head_damage_multiplier', 1.5) : 1;
  let total = 0;
  for (const c of weaponArr) {
    let amt = randInt(Number(c.min) || 1, Number(c.max) || 3);
    if (critical) amt = Math.floor(amt * getTunable('crit_multiplier', 1.5));
    total += Math.floor(amt * headMult);
  }
  const startHp = defender.hp ?? defender.hp_max ?? 20;
  // Floor first, THEN damage — so a capped swing can bruise but never finish.
  const damage = Math.max(1, Math.min(total, Math.max(0, startHp - floorHp)));
  defender.hp = Math.max(floorHp, startHp - damage);
  // Hitting someone makes it mutual: the defender turns on their attacker, which
  // is what turns one thrown punch into a fight without any brawl state machine.
  if (!defender._combatTargetId) defender._combatTargetId = attacker.id;

  const killed = defender.hp <= 0;
  if (killed) {
    defender._dead = true;
    defender._respawnAt = Date.now() + 60000;
    const zone = world.zones.get(defender.zone_id);
    if (zone) zone.npcs.delete(defender.id);
  }
  const partLabel = partLabelOf(part);
  return {
    hit: true, damage, critical, killed, npcId: defender.id,
    message: critical
      ? `<span class="crit-tag">CRITICAL HIT</span> ${attacker.name} hits ${defender.name}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageTypes}</span>!${killed ? ' They go down.' : ''}`
      : `${attacker.name} hits ${defender.name}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageTypes}</span>.${killed ? ' They go down.' : ''}`,
  };
}

// NPC swings at an ENEMY instance. The LAST empty cell of the matrix: until this
// existed, an NPC could fight a player and another NPC, and an enemy could fight
// anything at all, but nobody could ever put a friendly body between a player and
// a mob. That is the whole reason allied NPCs did not exist.
//
// Attacker side is `npcAttackNpc`'s, verbatim in spirit: flags.hit, flags.weapon,
// the same crit threshold and the same `_lastAttack` cooldown field the gameLoop
// retaliation loop uses — so an ally cannot swing at a player and an enemy in one
// tick, and a given NPC hits exactly as hard whoever they swing at.
//
// Defender side is `applyStrikeToEnemy`'s, NOT `npcAttackNpc`'s: enemies have
// authored body-part weights and TYPED SOAK, and skipping that is the bug where
// an ally's chemical spray cuts through carapace armour that a player's identical
// spray cannot. It also fires the enemy damage observers, so `plugins/injury`
// hangs a real wound off an ally's blow like anyone else's.
//
// ⚠ An enemy keeps `dodge` as a top-level column; an NPC keeps it in `flags`.
// (`enemyAttackEnemy` above reads `defender.flags?.dodge` against an enemy, which
// is why enemy-vs-enemy almost never misses. That is a bug, not a pattern.)
//
// Deliberately absent: executionShot, applyStun, rollWeaponStatus, water_shock.
// Every one is a function of a PLAYER's stats and equipped weapon, and an NPC has
// neither. An ally is a body that swings, not a second player.
//
// KILL CREDIT IS THE CALLER'S. Pass `{ credit: player }` and the kill counts for
// them; pass nothing and it counts for nobody. The engine deliberately does not
// know what an ally is — same arrangement `applyStrikeToEnemy` already has with
// its `player` argument. The caller is also responsible for the corpse, the
// `enemy.killed` event and the death prose; this returns the same killed-result
// shape `playerAttackEnemy`/`killEnemyInstance` do so no adapter is needed.
export async function npcAttackEnemy(npc, enemy, { credit = null } = {}) {
  if (!npc || !enemy || npc._dead || (enemy.hp ?? 0) <= 0) return null;
  if (getZoneProtection(enemy.zoneId)) return null;   // forcefield stops an ally too
  const now = Date.now();
  await ensureTunables();
  const attackInterval = getTunable('enemy_attack_interval_ms', 4000);
  if (now - (npc._lastAttack || 0) < attackInterval) return null;
  npc._lastAttack = now;

  const margin = ((npc.flags?.hit ?? 1) - (enemy.dodge ?? 1))
    + rollSwing() + await darknessHitPenalty(enemy.zoneId);
  if (margin < 0) {
    return { hit: false, killed: false, enemyId: enemy.instanceId,
      message: `${npc.name} swings at ${enemy.name} and misses.` };
  }

  const critical = margin >= getTunable('crit_threshold', 8);
  const weaponArr = Array.isArray(npc.flags?.weapon) && npc.flags.weapon.length
    ? npc.flags.weapon
    : [{ type: 'kinetic', min: 1, max: 3 }];
  const damageTypes = [...new Set(weaponArr.map(c => c.type))].join('/');
  const part = rollBodyPart(enemyBodyPartWeights(enemy));
  const headMult = part === 'head' ? getTunable('head_damage_multiplier', 1.5) : 1;

  let total = 0;
  let rawTotal = 0;
  for (const c of weaponArr) {
    let amt = randInt(Number(c.min) || 1, Number(c.max) || 3);
    if (critical) amt = Math.floor(amt * getTunable('crit_multiplier', 1.5));
    const swung = Math.floor(amt * headMult);
    const soaked = enemyPartSoak(enemy, part, c.type);
    rawTotal += swung;
    total += Math.max(0, swung - soaked);
  }
  const damage = Math.max(1, total);
  const partLabel = partLabelOf(part);

  // Observers BEFORE the hp write and before the kill check, exactly as
  // applyStrikeToEnemy does — injury needs to see the blow that finished it.
  // `attacker` is the CREDITED PLAYER, not the NPC: the only thing any observer
  // does with it is message a socket, and an npc id is not one. `via` carries
  // who actually swung, for anything that later wants to tell them apart.
  fireDamageToEnemy(enemy, {
    part, damage, baseDamage: Math.max(1, rawTotal),
    type: damageTypes, critical, source: 'npc', attacker: credit || null, via: npc,
  });

  enemy.hp = Math.max(0, (enemy.hp ?? enemy.hp_max ?? 20) - damage);

  // Make it mutual — but ONLY behind the flag. ai-behaviour honours a non-player
  // targetId on an enemy solely when `flags.attacks_npcs` is set; without it the
  // graph resolves the id as a player, gets null, and CLEARS the target. Setting
  // this unguarded would make an ally protect the player by giving every enemy
  // that hit it amnesia, which is the opposite of a bodyguard.
  if (enemy.flags?.attacks_npcs && !enemy.targetId) enemy.targetId = npc.id;

  const killed = enemy.hp <= 0;
  if (killed) {
    if (credit) {
      credit.mob_kills = (credit.mob_kills || 0) + 1;
      query('UPDATE players SET mob_kills=mob_kills+1 WHERE id=$1', [credit.id]).catch(() => {});
    }
    const loot = resolveEnemyLoot(enemy);
    removeEnemyInstance(enemy.instanceId);
    npc._combatTargetId = null;   // a stale instanceId is a leak the tick would chase
    return {
      hit: true, damage, critical, killed: true, part, partLabel,
      enemyId: enemy.instanceId,
      loot,
      butcher_table: enemy.butcher_table || [],
      butcher_difficulty: enemy.butcher_difficulty ?? 5,
      message: critical
        ? `<span class="crit-tag">CRITICAL HIT</span> ${npc.name} hits ${enemy.name}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageTypes}</span>!`
        : `${npc.name} hits ${enemy.name}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageTypes}</span>.`,
    };
  }

  return {
    hit: true, damage, critical, killed: false, part, partLabel,
    enemyId: enemy.instanceId,
    message: critical
      ? `<span class="crit-tag">CRITICAL HIT</span> ${npc.name} hits ${enemy.name}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageTypes}</span>!`
      : `${npc.name} hits ${enemy.name}'s <span class="hit-part">${partLabel}</span> for <span class="dmg-dealt">${damage}</span> <span class="dmg-type">${damageTypes}</span>.`,
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
  const part = rollBodyPart(targetWeights(defender));
  const partLabel = partLabelOf(part);
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
