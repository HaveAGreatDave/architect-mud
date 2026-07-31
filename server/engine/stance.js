// Combat stance substrate — the engine-owned mutation API for
// player.combat_stance and the transient `dodge` window. Modelled on posture.js:
// plugins own the *verbs* (fight / pow / dodge, in plugins/weapon), this module
// owns the *writes* and the numbers, so the field contract lives in one place.
//
// Stance is NOT posture. Posture is what your body is doing (standing, sitting,
// butchering); stance is how you're fighting. They're orthogonal — you can be
// cautious while standing or cautious while kneeling — and they must never be
// collapsed into one field (docs/systems-posture.md documents what happened the
// last time a parallel body-state field was introduced).
//
// Contract notes:
// - Mutates the live player object IN PLACE, same as posture.js. The game loop
//   holds direct references while it ticks; a clone-and-replace orphans them.
// - `speed` is a flat millisecond delta on the swing timer, NOT a multiplier and
//   NOT a per-weapon term. There is no weapon speed in the engine — swingInterval()
//   is the single seam a future per-weapon speed would enter.
// - `defense` is added to the DEFENDER'S DODGE TERM in the to-hit comparison, not
//   to soak. Because margin = attackerHit − defenderDodge and crit is margin >= 8,
//   defense also reduces the rate at which you get critted.
import { emit } from './events.js';
import { impairmentOf } from './impairment.js';

// The base player swing, before any stance modifier. combat.js seeds
// COOLDOWNS.attack from this so the number lives in exactly one place.
export const BASE_ATTACK_MS = 3500;

export const STANCES = {
  berserk:    { hit: -3, speed: -1000, defense: -2 },
  aggressive: { hit: +1, speed:  -500, defense: -2 },
  normal:     { hit:  0, speed:     0, defense:  0 },
  cautious:   { hit: +2, speed:  +500, defense: +1 },
  pacifist:   { hit: -1, speed: +1000, defense: +4 },
};

export const DEFAULT_STANCE = 'normal';

// The dodge move: +5 defense for 5s, or until the next attack attempt against
// you resolves — whichever lands first.
export const DODGE_WINDOW_MS = 5000;
export const DODGE_DEFENSE = 5;

// Per-stance flavour for the swing lines the player already gets every cycle.
// Only the verb clause changes — the damage/part/type spans around it are
// identical across stances, so the client CSS and dispatch handler are untouched.
const SWING_VERBS = {
  berserk:    'tear into',
  aggressive: 'drive into',
  normal:     'strike',
  cautious:   'jab at',
  pacifist:   'clip',
};

const MISS_LINES = {
  berserk:    (t) => `You hurl yourself at ${t} and crash past — wide open.`,
  aggressive: (t) => `You press ${t} hard and swing wide.`,
  normal:     (t) => `You swing at ${t} and miss. It doesn't look impressed.`,
  cautious:   (t) => `You test ${t}'s guard and find nothing.`,
  pacifist:   (t) => `You wave ${t} off with a half-hearted swing.`,
};

// Short third-person line broadcast to the zone when someone shifts stance —
// opponents should be able to SEE you change your guard.
const STANCE_TELLS = {
  berserk:    (n) => `${n}'s eyes go flat and hungry.`,
  aggressive: (n) => `${n} presses forward onto the front foot.`,
  normal:     (n) => `${n} settles back into an even guard.`,
  cautious:   (n) => `${n} shifts weight back, guarding.`,
  pacifist:   (n) => `${n} lowers their weapon and covers up.`,
};

export function isStance(id) {
  return Object.prototype.hasOwnProperty.call(STANCES, id);
}

export function getStance(player) {
  const s = player?.combat_stance;
  return isStance(s) ? s : DEFAULT_STANCE;
}

function mods(player) {
  return STANCES[getStance(player)] || STANCES[DEFAULT_STANCE];
}

// Returns the previous stance. Callers own the cooldown — this is the write, not
// the policy.
export function setStance(player, stance) {
  const from = getStance(player);
  const to = isStance(stance) ? stance : DEFAULT_STANCE;
  player.combat_stance = to;
  if (from !== to) emit('stance.changed', { player, from, to });
  return from;
}

// Added to a PLAYER ATTACKER's to-hit margin.
export function hitBonus(player) {
  // Stance is the intended modifier here; impairment rides alongside it because
  // this is the single place every to-hit margin is assembled. A wounded arm is
  // an arm that swings worse, and there is nowhere else to say so.
  return mods(player).hit + impairmentOf(player).hitMod;
}

// Added to a PLAYER DEFENDER's dodge term. The single place the stance defense
// and the transient dodge-move bonus combine, so every consumer gets both.
export function defenseBonus(player) {
  return mods(player).defense + (isDodging(player) ? DODGE_DEFENSE : 0);
}

// The player's swing time in ms, stance applied. Floored well above the 1s tick
// so a pathological stance stack can never produce a free-swing loop.
export function swingInterval(player) {
  return Math.max(1000, BASE_ATTACK_MS + mods(player).speed);
}

export function isDodging(player) {
  return (player?._dodgeUntil || 0) > Date.now();
}

export function armDodge(player) {
  player._dodgeUntil = Date.now() + DODGE_WINDOW_MS;
}

// Ends the dodge window. Called after ANY incoming attack against the player
// resolves — hit or miss — per the "or after the next attack attempt against
// you" half of the spec. Returns true if a window was actually open, so the
// caller can release the matching attack lock (combat.js owns the cooldown
// ledger; importing it here would close an import cycle).
export function consumeDodge(player) {
  if (!isDodging(player)) return false;
  player._dodgeUntil = 0;
  return true;
}

export function swingVerb(player) {
  return SWING_VERBS[getStance(player)] || SWING_VERBS[DEFAULT_STANCE];
}

export function missLine(player, targetName) {
  const fn = MISS_LINES[getStance(player)] || MISS_LINES[DEFAULT_STANCE];
  return fn(targetName);
}

export function stanceTell(player, handle) {
  const fn = STANCE_TELLS[getStance(player)] || STANCE_TELLS[DEFAULT_STANCE];
  return fn(handle);
}

// "+2 hit · +1 defense · 4.0s swing" — the dim modifier summary on the stance
// change line. Normal shows no modifier clauses, just its swing time.
export function stanceSummary(player) {
  const m = mods(player);
  const parts = [];
  if (m.hit) parts.push(`${m.hit > 0 ? '+' : ''}${m.hit} hit`);
  if (m.defense) parts.push(`${m.defense > 0 ? '+' : ''}${m.defense} defense`);
  parts.push(`${(swingInterval(player) / 1000).toFixed(1)}s swing`);
  return parts.join(' · ');
}
