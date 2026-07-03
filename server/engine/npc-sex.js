/**
 * NPC sex inference.
 *
 * NPCs carry a `sex` column ('male' | 'female' | 'other'), read by the clothing
 * system and the naked-look descriptions. It isn't set through the dev-panel
 * editor, so we decide it from the authored name + description — which almost
 * always carry gendered pronouns/nouns ("A lean man…", "she's stopped trying").
 *
 * Used by apiCreateNpc (auto-decide at creation) and the sex backfill script.
 */

const FEMALE = /\b(she|her|hers|herself|woman|women|girl|gal|lady|ladies|female|mother|mom|mum|sister|daughter|wife|widow|actress|waitress|mistress|madam|ma'?am|queen|princess|niece|aunt|grandmother|matron)\b/gi;
const MALE   = /\b(he|him|his|himself|man|men|boy|guy|gentleman|male|father|dad|brother|son|husband|widower|king|prince|nephew|uncle|grandfather|sir|mister)\b/gi;

// Returns 'male' | 'female' from the description's gendered language, or null when
// there's no signal (or a tie) — callers pick a fallback.
export function inferSex(name, description) {
  const text = `${name || ''} ${description || ''}`;
  const f = (text.match(FEMALE) || []).length;
  const m = (text.match(MALE)   || []).length;
  if (f > m) return 'female';
  if (m > f) return 'male';
  return null;
}

// Deterministic 'male' | 'female' from a seed string — used as the last-resort
// fallback for a genuinely gender-neutral NPC (e.g. one written with they/them),
// so no NPC is ever left as 'other' and re-runs are stable.
export function stableFlipSex(seed) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2 ? 'female' : 'male';
}

// Decide a binary sex for an NPC: caller-provided 'male'/'female' wins, else infer
// from the text, else the stable fallback. Never returns null or 'other' — the
// clothing and naked-look systems only model male/female.
export function decideSex(provided, name, description, seed) {
  if (provided === 'male' || provided === 'female') return provided;
  return inferSex(name, description) || stableFlipSex(seed || `${name || ''} ${description || ''}`);
}
