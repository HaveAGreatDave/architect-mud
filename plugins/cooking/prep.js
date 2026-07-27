// Prep — what you do to an ingredient before it meets heat.
//
// Pure reads over `custom_data`, same shape as fond.js and portions.js. Nothing
// here writes; the verbs in index.js stamp the flags and these functions say
// what those flags are worth.
//
// The house rule: every technique is a TRADE. Scoring opens the meat up — better
// seasoning, wider window, but it dries out faster if you miss. Marinating is a
// large gain that costs real time. Tenderising is mince's gentler cousin: faster
// and more forgiving, one rung off the top. None of them is free, so none of
// them is a button you always press.
import {
  SCORE_WINDOW_BONUS, SCORE_SEASON_BONUS, SCORE_DRYNESS, BUTTER_BONUS,
  MARINATE_MIN_MS, MARINATE_FULL_MS, MARINATE_BONUS, MARINATE_PROFILES,
  TENDERISE_RATE, TENDERISE_CEILING_DROP, TENDERISE_FORGIVENESS,
  MINCE_RATE, MINCE_CEILING_DROP,
} from './config.js';

export const isScored = row => !!row?.custom_data?.scored;
export const isTenderised = row => !!row?.custom_data?.tenderised;
export const marinatedAt = row => Number(row?.custom_data?.marinated_at) || 0;

// How much good a marinade has done, 0..1. Time is the whole cost — pull it out
// early and you have wasted the marinade rather than gained anything.
export function marinadeStrength(row, now = Date.now()) {
  const at = marinatedAt(row);
  if (!at) return 0;
  const soaked = now - at;
  if (soaked < MARINATE_MIN_MS) return 0;
  if (soaked >= MARINATE_FULL_MS) return 1;
  return (soaked - MARINATE_MIN_MS) / (MARINATE_FULL_MS - MARINATE_MIN_MS);
}

export function marinadeText(row, now = Date.now()) {
  if (!marinatedAt(row)) return null;
  const s = marinadeStrength(row, now);
  if (s === 0) return 'sitting in the marinade, and it has barely begun to take';
  if (s < 1) return 'taking the marinade, though it would keep going';
  return 'right through with the marinade';
}

// The multiplier on cook duration from everything done to it beforehand.
export function prepRateMult(cd = {}) {
  let rate = 1;
  if (cd.minced) rate *= MINCE_RATE;
  if (cd.tenderised) rate *= TENDERISE_RATE;
  return rate;
}

// How many rungs come off the ceiling. Mince and tenderising both cost the top,
// by different amounts; they don't stack past mince's own price because mince
// has already destroyed everything tenderising would have.
export function prepCeilingDrop(session = {}) {
  if (session.minced) return MINCE_CEILING_DROP;
  if (session.tenderised) return TENDERISE_CEILING_DROP;
  return 0;
}

// How much wider the peak window is. Scoring and tenderising both buy slack —
// the first because the heat gets in, the second because there is less of it to
// get through.
export function prepWindowMult(session = {}) {
  let mult = 1;
  if (session.scored) mult *= SCORE_WINDOW_BONUS;
  if (session.tenderised) mult *= TENDERISE_FORGIVENESS;
  return mult;
}

// ...and what it does to the GRACE after the peak, which is where scoring is
// paid for. The cuts that let heat in let moisture out, so a scored cut goes
// from past-its-best to charred in appreciably less time. Without this, scoring
// is a wider window, a seasoning bonus and no cost at all — a button you would
// always press, which is the one thing no prep verb is allowed to be.
export function prepBurnMult(session = {}) {
  return session.scored ? SCORE_DRYNESS : 1;
}

// Flat score the prep contributes at plating.
//
// The marinade term reads `session.marinade` — a strength FROZEN by cook.js when
// the food went on the heat. It is deliberately not recomputed from `now`: a
// marinade stops working once the pan starts. (Sessions stamped before that
// change carry a raw `marinated_at` instead; they fall back to the old reading
// so an in-flight cook doesn't lose its bonus mid-way.)
export function prepBonus(session = {}, now = Date.now()) {
  let bonus = 0;
  if (session.scored) bonus += SCORE_SEASON_BONUS;
  if (session.buttered) bonus += BUTTER_BONUS;
  const strength = Number.isFinite(session.marinade)
    ? Math.max(0, Math.min(1, session.marinade))
    : session.marinated_at
      ? marinadeStrength({ custom_data: { marinated_at: session.marinated_at } }, now)
      : 0;
  bonus += MARINATE_BONUS * strength;
  return bonus;
}

export const canMarinate = profileName => MARINATE_PROFILES.includes(profileName);

// What examine says about an ingredient that has been worked on but hasn't met
// heat yet. Without this the marinade timer exists and nobody can read it —
// the same reason `restText` had to exist for a plated cut.
export function prepText(cd = {}, now = Date.now()) {
  const parts = [];
  const marinade = marinadeText({ custom_data: cd }, now);
  if (marinade) parts.push(marinade);
  if (cd.scored) parts.push('scored across the fat');
  if (cd.tenderised) parts.push('beaten out flat');
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
