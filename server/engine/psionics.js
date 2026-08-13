/**
 * PSIONICS — the substrate under the Exodus discipline.
 *
 * The Wildblood become something else (mutations). The Ascendants build something
 * better (augments). The Null make the machine go silent (nullcraft). The Long
 * Watch master themselves (mastery). The Exodus hold that reality is more
 * permeable than you thought, and this is the seam that lets them.
 *
 * ── The rule this file exists to enforce ─────────────────────────────────────
 *
 * THE MIND IS DOING SOMETHING THE BODY WAS NOT BUILT TO SUPPORT, SO THE BODY PAYS.
 *
 * Resonance is capacity and strain is the bill. Everything expensive in this
 * system is expensive in blood: nosebleeds, then blood from the ears and failing
 * eyes, then a seizure on the floor in front of whoever you were fighting, then a
 * real injury a doctor has to fix. That ladder is not flavour bolted onto a mana
 * bar — it is the only thing bounding compulsion, the only thing stopping a psion
 * holding a forcefield forever, and the reason a psion is a devastating fifth
 * member of a crew and a bad person to be alone.
 *
 * It is also the deniability ladder. A nosebleed in a bar is nothing. A man
 * convulsing with blood coming out of his ears while a door he never touched
 * swings open is not deniable at all, and that is the arc: low rank looks like
 * luck, high rank cannot be explained away. See prose.js in the plugin — the
 * phrasing law lives in ONE function so it can be enforced rather than wished for.
 *
 * ── Read tier ────────────────────────────────────────────────────────────────
 *
 * Everything in the first section is SYNC BY CONTRACT — no awaits, no queries.
 * These are read from the appearance path (glowing glyphs), from resistance
 * netting, and from combat-adjacent code. This is the `relations.js` / `hygieneOf`
 * / `nullcraft.js` contract and it must not be relaxed: if one of these ever needs
 * to await, the caller is wrong, not this file.
 *
 * ── Persistence tier ─────────────────────────────────────────────────────────
 *
 * Resonance, strain and signatures live in module-scope Maps and are DECAYED AT
 * READ against a timestamp. Nothing ticks and nothing is written. A logout drops
 * them, which is correct: waking up rested is what sleep is for, and state that
 * survived a relog would be state pretending to matter.
 *
 * THIS FILE OWNS NO TABLE. The only durable half of psionics is two player_flags
 * (`psi_rank`, `psi_focus`) written through flags.js, and any real INJURY, which
 * reaches the database through the injury plugin's own writer. Do not add a
 * column here — the moment resonance persists, "rest to recover" stops being a
 * decision and becomes a countdown.
 */
import { effectiveSkill, skillCheck } from './skills.js';
import {
  RANKS, rankIndex, rankAtLeast, getPsiAbility, abilityApplies,
  CHOOSE_FOCUS_AT, SECOND_FOCUS_AT,
} from './psionics-abilities.js';

// ── Tuning ───────────────────────────────────────────────────────────────────

// Resonance regenerates on its own, slowly. The half-life is long in real terms —
// about ten minutes to come back from empty — because resonance is a STRATEGIC
// budget, not a cooldown. A psion who spends everything in a fight should be
// spent for the rest of the errand, and should be thinking about a bed.
export const RESONANCE_REGEN_HALFLIFE_MS = 300_000;

// Strain bleeds off faster than resonance returns, which is deliberate: the body
// stops bleeding before the mind is ready to go again. Otherwise the optimal play
// is always to keep pushing while you are already hurt.
export const STRAIN_HALFLIFE_MS = 180_000;

// The strain ladder. Named bands rather than raw numbers because every consumer
// (backlash, prose, the glyph glow, the HUD) asks the same question and must get
// the same answer — a second threshold table somewhere else is how these drift.
export const STRAIN_BANDS = [
  { id: 'low',      at: 0 },
  { id: 'moderate', at: 25 },   // nosebleed
  { id: 'high',     at: 50 },   // ears, failing sight, abilities start failing on their own
  { id: 'critical', at: 75 },   // seizure: you go down where you stand
  { id: 'overload', at: 100 },  // seizure plus real injury a doctor has to fix
];
export const STRAIN_MAX = 120;

/**
 * ⚠ Nothing psionic ever reaches certainty.
 *
 * The Null's VEIL_CAP exists because a player no camera can see has left the
 * game's consequence loop rather than outplayed it. This is the same cap for the
 * same reason, applied to a wider surface: no forcefield is total immunity, no
 * compulsion is unbreakable, no mind is unreadable, no read is the whole truth.
 * Every contest in this system leaves a gap, and the gap is where the other
 * player's agency lives.
 */
export const PSI_CAP = 0.85;

// playerId -> { spent, strain, at }
//
// Note `spent` rather than `resonance`: the pool is DERIVED (rank + skill), so
// storing what has been used rather than what is left means a player who ranks up
// or trains mid-session gets the bigger pool immediately instead of being capped
// at a number that was written down when they were weaker.
const playerState = new Map();

// zoneId -> [{ discipline, strength, at, playerId }]  — the Exodus trace analogue
const signatures = new Map();
export const SIGNATURE_HALFLIFE_MS = 600_000;
const SIGNATURE_MAX_PER_ZONE = 12;

const now = () => Date.now();

/** Exponential decay to a timestamp. The whole persistence story of this file. */
function decayed(value, at, halfLife) {
  if (!(value > 0)) return 0;
  const elapsed = now() - (at || 0);
  if (elapsed <= 0) return value;
  return value * Math.pow(0.5, elapsed / halfLife);
}

// ── Rank and focus (durable half) ────────────────────────────────────────────
//
// ⚠ Read `player._flags` DIRECTLY, never `getFlag()`.
//
// `getFlag(scope, key, player)` is async — it is the writer-aware accessor and it
// may go to the database. Everything in this file is sync by contract (the
// appearance path, resistance netting and combat-adjacent code all call it), so
// awaiting here would break the contract at every call site at once.
//
// `player._flags` is the hydrated-at-login Map that flags.js maintains, and
// reading it directly is the established sync pattern — `plugins/injury/index.js`
// does exactly this for its taught-verb check, and presentation.js does it for
// `display_mode`. The rule that makes it safe is flags.js's own: nothing writes
// `player_flags` outside that module, so the Map is never stale.

function flag(player, key) {
  return player?._flags?.get(key) ?? null;
}

/** A player's rank, or null if they have never awakened. Sync — flags are hydrated at login. */
export function psiRank(player) {
  if (!player) return null;
  const r = flag(player, 'psi_rank');
  return rankIndex(r) >= 0 ? r : null;
}

export function isAwakened(player) { return psiRank(player) !== null; }

/**
 * The player's chosen discipline, and their weaker secondary.
 *
 * Below CHOOSE_FOCUS_AT there is no focus and `focusMultiplier` treats everything
 * as in-focus — a player should be able to feel out all six before committing,
 * because the choice is only meaningful if you have tasted the options.
 */
export function psiFocus(player) {
  if (!player) return null;
  return flag(player, 'psi_focus');
}
export function psiSecondFocus(player) {
  if (!player) return null;
  if (!rankAtLeast(psiRank(player), SECOND_FOCUS_AT)) return null;
  return flag(player, 'psi_focus_second');
}
export function hasChosenFocus(player) {
  return rankAtLeast(psiRank(player), CHOOSE_FOCUS_AT) && !!psiFocus(player);
}

/**
 * Cost multipliers for reaching outside what you are.
 *
 * YOU MAJOR IN ONE ART AND MINOR IN ANOTHER, and you are only ever truly
 * exceptional in your major. In your major you pay base; your minor is most of
 * double; anything else is triple and gives you a nosebleed for the trouble. That
 * is the honest way to say "this is not what you are" without a hard refusal — a
 * dreamwalker CAN nudge a cup, they just should not plan an evening around it.
 *
 * Top-tier abilities set `focusOnly` and are refused outright rather than priced,
 * at any cost, because there must be no build that both takes bodies and walks
 * dreams. Exceptional is singular or it is not exceptional.
 */
export function focusMultiplier(player, discipline) {
  if (!hasChosenFocus(player)) return { resonance: 1, strain: 1, tier: 'open' };
  if (discipline === psiFocus(player)) return { resonance: 1, strain: 1, tier: 'primary' };
  if (discipline === psiSecondFocus(player)) return { resonance: 1.75, strain: 1.5, tier: 'secondary' };
  return { resonance: 3, strain: 2.5, tier: 'foreign' };
}

// ── Resonance and strain (sync accessors — see the header) ───────────────────

/**
 * How much resonance this player can hold at full.
 *
 * Derived from rank and skill, never stored. This is the same invariant that made
 * mutations' and augments' migrations net-zero: a derived pool cannot drift out of
 * step with the thing it is derived from, and there is no column to migrate when
 * the formula changes.
 */
export function maxResonance(player) {
  const rank = psiRank(player);
  if (!rank) return 0;
  return 20 + (rankIndex(rank) * 10);
}

/** Live resonance and strain, both decayed. An unknown player is rested. */
export function psiState(player) {
  const max = maxResonance(player);
  const s = playerState.get(player?.id);
  if (!s) return { resonance: max, max, spent: 0, strain: 0 };
  const spent = decayed(s.spent, s.at, RESONANCE_REGEN_HALFLIFE_MS);
  const strain = decayed(s.strain, s.at, STRAIN_HALFLIFE_MS);
  return {
    resonance: Math.max(0, max - spent),
    max, spent, strain,
  };
}

export function resonanceOf(player) { return psiState(player).resonance; }
export function strainOf(player) { return psiState(player).strain; }

/** Which band of the ladder this much strain sits in. */
export function strainBand(strain) {
  let band = STRAIN_BANDS[0].id;
  for (const b of STRAIN_BANDS) if (strain >= b.at) band = b.id;
  return band;
}
export function strainBandOf(player) { return strainBand(strainOf(player)); }

/**
 * Spend resonance and take strain.
 *
 * Both decay FIRST, so time away is never retroactively cancelled by one more
 * push — the same ordering `addTrace` and `adjustReputation` use, and for the same
 * reason: a stale value resurrected by a fresh delta is a bug that only shows up
 * in players who took a break.
 *
 * Returns the resulting state so the caller can decide whether a backlash roll is
 * owed, rather than this file reaching into the injury system. Deciding what a
 * seizure DOES is policy and lives in the plugin; holding the number is substrate
 * and lives here.
 */
export function spend(player, resonance = 0, strain = 0) {
  const cur = psiState(player);
  playerState.set(player.id, {
    spent: Math.max(0, Math.min(cur.max, cur.spent + resonance)),
    strain: Math.max(0, Math.min(STRAIN_MAX, cur.strain + strain)),
    at: now(),
  });
  return psiState(player);
}

/** Give resonance back — sleep, meditation, a crystal. Never touches strain. */
export function recover(player, amount) {
  const cur = psiState(player);
  playerState.set(player.id, {
    spent: Math.max(0, cur.spent - amount),
    strain: cur.strain,
    at: now(),
  });
  return psiState(player);
}

/** Bleed strain off directly — dreamroot, a long rest, a clinic. */
export function relieveStrain(player, amount) {
  const cur = psiState(player);
  playerState.set(player.id, {
    spent: cur.spent,
    strain: Math.max(0, cur.strain - amount),
    at: now(),
  });
  return psiState(player);
}

// ── Signature — who has been working here ────────────────────────────────────
//
// The supernatural counterpart to the Null's electronic trace, and deliberately
// the same shape. Using a power leaves a mark on the ROOM (not on the psion), it
// decays on its own, and another psion can read it. That is what makes psychometry
// worth pointing at a place a rival has been, and what makes a high-rank psion
// findable by their own kind.
//
// Strength scales with how loud the ability was, so Phase 1's quiet reads leave
// almost nothing and a Resonance-tier discharge leaves something legible for the
// best part of an hour.

export function addSignature(playerId, zoneId, discipline, strength = 1) {
  if (!zoneId) return;
  const list = signatures.get(zoneId) || [];
  list.push({ discipline, strength, at: now(), playerId });
  // Bounded: a room is a ring buffer, not a log. The oldest goes first, and the
  // cap is what stops a psion working in one room forever from growing an array
  // nothing ever trims.
  while (list.length > SIGNATURE_MAX_PER_ZONE) list.shift();
  signatures.set(zoneId, list);
}

/** Readable signatures in a zone, decayed, faintest dropped. Sync by contract. */
export function signatureAt(zoneId) {
  const list = signatures.get(zoneId);
  if (!list) return [];
  const out = [];
  for (const s of list) {
    const strength = decayed(s.strength, s.at, SIGNATURE_HALFLIFE_MS);
    if (strength >= 0.15) out.push({ ...s, strength });
  }
  if (out.length !== list.length) signatures.set(zoneId, out);
  return out;
}

export function clearSignatures(zoneId) { signatures.delete(zoneId); }

// ── Gates ────────────────────────────────────────────────────────────────────

/**
 * Can this player use this ability at all, and if not, why not?
 *
 * Returns null when it is allowed, a string when it is refused, and the sentinel
 * `UNKNOWN` when the ability should not appear to exist for them.
 *
 * That third case is the `ORGAN_FLOOR` convention from plugins/mutations/organs.js
 * and it matters: below the floor the verb answers `Unknown command.` rather than
 * an explanation. The ladder is discovered by meeting someone who has climbed it,
 * not by reading a locked list — which is also the only way the top stays rare in
 * a game where players share notes.
 */
export const UNKNOWN = Symbol('psi.unknown');

export function abilityRefusal(player, abilityId, targetKind = null) {
  const ability = getPsiAbility(abilityId);
  if (!ability) return UNKNOWN;

  const rank = psiRank(player);
  if (!rank) return UNKNOWN;
  if (!rankAtLeast(rank, ability.rank)) return UNKNOWN;

  // Gate 4, and the reason the top of the ladder is genuinely gated rather than
  // merely expensive: a flag nothing raises except authored content. Same trick as
  // the mutagen shelf — it does not exist for anyone who has not been through the
  // arc that sets it.
  if (ability.unlockFlag && !flag(player, ability.unlockFlag)) return UNKNOWN;

  // Gate 2. focusOnly is unreachable off-focus at ANY cost — this is what makes
  // the archetypes real rather than a pricing preference.
  if (ability.focusOnly && hasChosenFocus(player) && ability.discipline !== psiFocus(player)) {
    return UNKNOWN;
  }

  // Below here the ability exists for you and can say why it will not work.
  if (targetKind && !abilityApplies(abilityId, targetKind)) {
    return `That is not a thing you can ${ability.label.toLowerCase()}.`;
  }

  const mult = focusMultiplier(player, ability.discipline);
  const cost = ability.resonance * mult.resonance;
  const state = psiState(player);
  if (state.resonance < cost) {
    return 'There is nothing left to reach with. You need to rest.';
  }

  // The high band is where abilities start failing on their own; critical is where
  // the body stops cooperating entirely. Refusing here rather than letting the
  // player push is deliberate — a seizure should be the price of a CHOICE to keep
  // going, not something that happens because they did not know the number.
  if (strainBand(state.strain) === 'critical' || strainBand(state.strain) === 'overload') {
    return 'You are shaking too hard to hold anything steady.';
  }

  return null;
}

/** Gate 3: the skill floor, checked separately so callers can report it. */
export async function meetsSkillFloor(player, abilityId) {
  const ability = getPsiAbility(abilityId);
  if (!ability || !ability.minSkill) return true;
  return (await effectiveSkill(player, 'psionics')) >= ability.minSkill;
}

/** What this ability actually costs this player, focus multipliers applied. */
export function abilityCost(player, abilityId) {
  const ability = getPsiAbility(abilityId);
  if (!ability) return { resonance: 0, strain: 0, tier: 'open' };
  const mult = focusMultiplier(player, ability.discipline);
  return {
    resonance: Math.round(ability.resonance * mult.resonance),
    strain: Math.round(ability.strain * mult.strain),
    tier: mult.tier,
  };
}

/**
 * Roll an ability.
 *
 * Kept separate from the minigame so the two rungs of the Display Mode ladder that
 * do not play a board still get an authoritative outcome from the same numbers.
 * Returns the raw check so callers can report margin to `awardSkillUse` — remember
 * its third argument is the MARGIN, not an amount.
 *
 * Strain raises the difficulty rather than adding a separate fumble roll: a shaking
 * psion is worse at everything, and one number moving is easier to reason about
 * than two systems arguing.
 */
export async function psiCheck(player, abilityId, extraDifficulty = 0) {
  const ability = getPsiAbility(abilityId);
  if (!ability) return { success: false, margin: -99, swing: 0, effective: 0, difficulty: 99 };
  const band = strainBandOf(player);
  const strainPenalty = band === 'high' ? 3 : band === 'moderate' ? 1 : 0;
  const difficulty = ability.difficulty + extraDifficulty + strainPenalty;
  return skillCheck(player, 'psionics', difficulty);
}

/** Drop every scrap of runtime state for a player. Called on logout. */
export function forgetPlayer(playerId) {
  playerState.delete(playerId);
  for (const [zoneId, list] of signatures) {
    const kept = list.filter(s => s.playerId !== playerId);
    if (kept.length) signatures.set(zoneId, kept);
    else signatures.delete(zoneId);
  }
}

/** Test seam — a non-zero count with nobody playing means a leak. */
export function _liveStateCount() { return playerState.size; }
export { RANKS };
