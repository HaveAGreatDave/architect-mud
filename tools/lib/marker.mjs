// Building map-marker derivation — the ONE copy.
//
// `zones.marker` is the 2-glyph code a building wears in Labels mode on every map
// surface. It is AUTHORED: the renderers used to each derive their own acronym from
// the building name and disagreed ("Hall of Records" read "HA" on the sidebar and
// "HO" on the tablet while the authored "HR" rendered nowhere), so the derivation
// moved to authoring time (36f1b8f3) and no renderer invents one any more.
//
// Authoring time still needs a derivation — a suggestion to stamp and a test for
// "does this code read as coming from that name". Both live here so the map audit
// (which grades markers) and the placement CLI (which stamps them) cannot drift.
//
// FUTURE HOME: docs/proposals/map-pipeline-spec.md §7.4 moves marker derivation into
// the derive module, where the build sees all 61 codes at once and can disambiguate
// collisions deterministically. When that lands, this module moves there wholesale —
// it does NOT get copied.

// The significant words of a name. The possessive is stripped BEFORE splitting, or
// "Halloran's Fix-It" becomes [Halloran, s, Fix, It] and abbreviates to "HS" not "HF".
const STOP_WORD = /^(the|of|and|at|a|an|&)$/i;

export const sigWords = (name) => String(name || '')
  .replace(/['’]s\b/g, '')
  .replace(/[^A-Za-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter((w) => w && !STOP_WORD.test(w));

// The single suggested acronym: initials of the significant words, or the first two
// letters of a lone word. A suggestion only — collisions are a human call (MARK-4).
export function twoLetterAbbrev(name) {
  const words = sigWords(name);
  if (!words.length) return null;
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase() || null;
  return words.map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

// Every 2-glyph code that reads as DERIVED FROM the name. Deliberately wider than
// twoLetterAbbrev()'s single suggestion, because more than one honest acronym exists —
// any ordered pair of the significant words' initials ("Embassy Hotel & Bar" → EH, EB,
// HB) and the first two letters of any one of those words ("The Stacks" → ST). Still
// narrow enough that a thematic code falls outside it, which is the point: `GN` on the
// gunshop Ironside Arms is a choice, not an acronym.
export function nameDerivedMarkers(name) {
  const words = sigWords(name);
  const out = new Set();
  const ini = words.map((w) => w[0].toUpperCase());
  for (let i = 0; i < ini.length; i++) for (let j = i + 1; j < ini.length; j++) out.add(ini[i] + ini[j]);
  for (const w of words) if (w.length >= 2) out.add(w.slice(0, 2).toUpperCase());
  return out;
}

// Pick a code that isn't already worn by another building (MARK-4). Tries the
// suggestion, then the other name-derived codes in a stable order, then suffixes the
// first significant word's initial with digits. Deterministic: same name + same taken
// set always yields the same code.
export function uniqueMarkerFor(name, taken) {
  const used = taken instanceof Set ? taken : new Set(taken || []);
  const first = twoLetterAbbrev(name);
  if (first && !used.has(first)) return first;
  for (const cand of [...nameDerivedMarkers(name)].sort()) {
    if (!used.has(cand)) return cand;
  }
  const lead = (sigWords(name)[0] || 'X')[0].toUpperCase();
  for (let i = 2; i <= 9; i++) if (!used.has(lead + i)) return lead + i;
  return first;
}
