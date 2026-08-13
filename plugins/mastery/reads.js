/**
 * Read — the mechanical identity of the Long Watch.
 *
 * A fighter learns an opponent by fighting it. Stance, breathing, weight, where
 * the weapon sits, what tenses before what. Not psychic; observation. The first
 * few exchanges teach you, and then you start knowing what is coming.
 *
 * The consequence is the point: EVERY OTHER BUILD IN THIS GAME GETS WORSE OVER A
 * LONG FIGHT — stamina drains, condition degrades, wounds bleed — and this one
 * gets better. That inversion is the whole reason the system exists, and any
 * change that flattens it has removed the feature while leaving the code.
 *
 * TWO LAYERS, and only one of them persists:
 *
 *   HEAT       per enemy INSTANCE, in RAM, lost on logout. This is the
 *              within-a-fight curve. Losing it on logout is correct: you do not
 *              log in mid-read of a thing that is no longer in front of you.
 *
 *   FAMILIARITY  per ARCHETYPE, in the DB. What you know about a KIND of thing,
 *              which is what survives the kill. Heat converts into it at a
 *              discount when a fight ends, so a hundred short fights teach you
 *              less than the same time spent in a few long ones.
 *
 * The archetype key is `enemy.templateId`, not `instanceId` — fight four hundred
 * dogs and you have ONE row. `pvp` is a single shared key for all human
 * opponents on purpose: a player is not an archetype, and a per-player Read
 * would be a dossier system nobody asked for.
 */
import { getRead, adjustRead } from './state.js';
import { effectiveRank } from './purity.js';
import { matchExploits } from './exploits.js';

// Heat needed to reach each tier, and what the tier is called. `pattern` is the
// rung the reaction window unlocks at (P5) — below it you are still watching.
const TIERS = [
  [0, 'blank'], [3, 'watching'], [7, 'pattern'], [13, 'read'], [22, 'solved'],
];
export const TIER_ORDER = ['blank', 'watching', 'pattern', 'read', 'solved'];

// Heat converts to durable familiarity at a discount, and only so much of it
// counts: a single grinding fight should not max an archetype outright.
const HEAT_CONVERT_RATE = 0.25;
const HEAT_CONVERT_CAP = 12;

// A fight nobody has swung in for this long is over, whatever the enemy is doing.
const FIGHT_IDLE_MS = 60000;

// Familiarity is a HEAD START on heat, never a replacement for it. Knowing the
// kind of thing means you begin the fight already watching; it does not mean you
// have read the individual in front of you before it has moved.
const FAMILIARITY_HEAD_START = 0.08;

/** The stable key for "this kind of opponent". Never an instance id. */
export function archetypeOf(enemy) {
  if (!enemy) return null;
  if (enemy.templateId) return `enemy:${enemy.templateId}`;
  // A player. One key for all of them — see the header.
  if (enemy.handle) return 'pvp';
  if (enemy.id) return `npc:${enemy.id}`;
  return null;
}

export function readTier(heat) {
  let out = 'blank';
  for (const [floor, label] of TIERS) if (heat >= floor) out = label;
  return out;
}

export function tierAtLeast(tier, want) {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(want);
}

/** Live heat on a specific opponent, including the head start familiarity buys. */
export function heatOn(player, enemy) {
  const key = enemy?.instanceId || enemy?.id;
  if (!key) return 0;
  const live = player?._readHeat?.get(key)?.heat || 0;
  const fam = getRead(player, archetypeOf(enemy)).familiarity;
  return live + (fam * FAMILIARITY_HEAD_START);
}

export function tierOn(player, enemy) {
  return readTier(heatOn(player, enemy));
}

/**
 * Called from the swing seam's 'post', both directions, INCLUDING ON A MISS.
 *
 * SYNC BY CONTRACT — no await, no query, no send. Everything here touches only
 * the live player object.
 *
 * A miss teaches you as much as a hit, which is the reason this hangs off the
 * swing seam rather than damage-events: a damage observer never sees the swing
 * that went past your ear, and that is the one you learn the most from.
 */
export function noteExchange(player, enemy, ctx) {
  if (!player || !enemy) return null;
  const key = enemy.instanceId || enemy.id;
  const archetype = archetypeOf(enemy);
  if (!key || !archetype) return null;

  // Combat discipline is what makes you able to read at all. An untrained
  // fighter accrues nothing — this must never become a thing everyone slowly
  // gets for free, or the Long Watch have no identity left.
  const disc = effectiveRank(player, 'combat');
  if (disc < 10) return null;

  if (!(player._readHeat instanceof Map)) player._readHeat = new Map();
  const rec = player._readHeat.get(key)
    || { heat: 0, archetype, exchanges: 0, lastAt: 0, tier: 'blank' };

  // A defended swing teaches more than one you threw: you learn a thing's
  // timing by being on the receiving end of it.
  const gain = (ctx?.kind === 'incoming' ? 1.4 : 1) * (0.5 + disc / 100);
  rec.heat += gain;
  rec.exchanges += 1;
  rec.lastAt = Date.now();

  const before = rec.tier;
  rec.tier = readTier(rec.heat + getRead(player, archetype).familiarity * FAMILIARITY_HEAD_START);
  player._readHeat.set(key, rec);

  const out = { rec, crossed: rec.tier !== before ? rec.tier : null, exploit: null };

  // An Exploit is the payoff, and it is gated on the READ tier rather than on
  // rank alone — you cannot know where a thing is weak until you have watched
  // it move. Discovered once per archetype, then remembered forever.
  if (tierAtLeast(rec.tier, 'read')) {
    const known = getRead(player, archetype).exploits;
    const found = matchExploits(enemy).find(e => !known.includes(e.id));
    if (found) {
      adjustRead(player, archetype, { exploit: found.id });
      out.exploit = found;
    }
  }
  return out;
}

/**
 * A fight ended — bank what was learned. Called when an enemy dies and swept for
 * anything gone quiet by the plugin's 1m tick.
 *
 * The discount is what stops a single long grind maxing an archetype, and the
 * cap is what stops one absurd fight doing it either.
 */
export function bankHeat(player, key) {
  const rec = player?._readHeat?.get(key);
  if (!rec) return 0;
  player._readHeat.delete(key);
  const banked = Math.min(rec.heat, HEAT_CONVERT_CAP) * HEAT_CONVERT_RATE;
  if (banked > 0) adjustRead(player, rec.archetype, { familiarity: banked });
  return banked;
}

/** Sweep fights that have gone quiet. Called from the 1m tick, sync. */
export function sweepStaleFights(player, now = Date.now()) {
  if (!(player?._readHeat instanceof Map)) return 0;
  let n = 0;
  for (const [key, rec] of [...player._readHeat]) {
    if (now - rec.lastAt > FIGHT_IDLE_MS) { bankHeat(player, key); n++; }
  }
  return n;
}

/** What a tier actually says, out loud. The prose IS the reward. */
export function tierLine(tier, name) {
  switch (tier) {
    case 'watching': return `<span class="text-dim">You are starting to see how ${name} carries itself.</span>`;
    case 'pattern':  return `<span class="text-dim">There is a pattern in it. You have not got it yet, but it is there.</span>`;
    case 'read':     return `<span class="crit-tag">You have its rhythm.</span>`;
    case 'solved':   return `<span class="crit-tag">You know what it is going to do before it does.</span>`;
    default: return '';
  }
}

export const _test = { TIERS, HEAT_CONVERT_RATE, HEAT_CONVERT_CAP, FIGHT_IDLE_MS, FAMILIARITY_HEAD_START };
