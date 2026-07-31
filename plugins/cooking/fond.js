// Fond — what a sear leaves behind, and what lifting it is worth.
//
// Pure functions over a vessel row's `custom_data.fond`, in the same spirit as
// quality.js: no DB, no clock of its own. `fond` is a small blob —
// `{ from, band, at }` — and everything else (is it still good, is it residue
// now, what is it worth) is derived from that and `now` at the moment somebody
// asks. Two cooks in a row in the same pan is the only place in the system
// where one cook can see another, so this is the only state that persists on a
// vessel between them.
import {
  FOND_PROFILES, FOND_MIN_BAND, FOND_VESSELS, FOND_BONUS,
  FOND_RESIDUE_PENALTY, FOND_LIFE_MS, FOND_MISMATCH_PENALTY,
  FOND_NEGLECT_PENALTY, FOND_PASSIVE_FRACTION,
} from './config.js';
import { bandIndex } from './profiles.js';

// Does this cook leave anything in the pan? A cut browned in a dry-ish pan
// does; a broth boiled in a pot does not, and neither does a ruined sear.
export function leavesFond({ vesselKind, profiles = [], band, hadLiquid = false, microwave = false }) {
  // A microwave never browns anything, so there is nothing left in the pan. Same
  // physical fact as its quality ceiling, expressed on the other side.
  if (microwave) return false;
  if (!FOND_VESSELS.includes(vesselKind)) return false;
  if (hadLiquid) return false;                       // already lifted, or never formed
  if (bandIndex(band) < bandIndex(FOND_MIN_BAND)) return false;
  return profiles.some(p => FOND_PROFILES.includes(p));
}

export const makeFond = (profile, band, at = Date.now()) => ({ from: profile, band, at });

// Fond has three lives: usable, dried to residue, and gone. The middle one is
// the interesting one — a pan you browned in and then ignored is WORSE than a
// clean pan until you scour it.
export function fondState(fond, now = Date.now()) {
  if (!fond?.at) return 'none';
  return now - fond.at <= FOND_LIFE_MS ? 'fresh' : 'residue';
}

// What the vessel's current state is worth to a dish being made in it now.
// Lifting fresh fond pays; cooking on top of dried residue costs.
// Does what made this fond belong in what's being made now? A pan that seared
// meat lifts beautifully into anything savoury; the same pan lifts into a fruit
// dish and you can taste the last thing that was in it.
// A template may declare `fondFrom` when what it's BUILT ON isn't something it
// contains. A pan sauce is liquid and seasoning and nothing else — that's the
// whole idea of it — so the meat fond it exists to lift appears in neither its
// `needs` nor its `optional`, and inferring from those alone would penalise the
// one combination the dish was written for. Everything else infers, because for
// an ordinary dish "belongs in this" really does mean "is an ingredient of it".
export function fondBelongs(fond, template) {
  if (!fond?.from || !template) return true;   // nothing to clash with
  if (template.fondFrom) return template.fondFrom.includes(fond.from);
  const allowed = new Set([...Object.keys(template.needs || {}), ...(template.optional || [])]);
  return allowed.has(fond.from);
}

// Three ways a fresh pan can go, and none of them is "nothing happened":
//   scraped        — the technique, paid in full
//   liquid, unscraped — it lifts anyway, partially; you just didn't help
//   dry, unscraped    — it sits on the heat and scorches
// Whichever applies, the sign flips if what made the fond doesn't belong in
// what's being made now: a pan that seared fish makes the fruit taste of fish,
// and it does that just as readily on its own as it does off a spoon.
export function fondModifier(fond, { deglazed = false, hadLiquid = false, template = null, now = Date.now() } = {}) {
  const state = fondState(fond, now);
  if (state === 'fresh') {
    const value = fondBelongs(fond, template) ? FOND_BONUS : FOND_MISMATCH_PENALTY;
    if (deglazed) return value;
    if (hadLiquid) return value * FOND_PASSIVE_FRACTION;
    return FOND_NEGLECT_PENALTY;
  }
  if (state === 'residue') return FOND_RESIDUE_PENALTY;
  return 0;
}

// What examine says about the pan itself.
export function fondText(fond, now = Date.now()) {
  const state = fondState(fond, now);
  if (state === 'fresh') return 'the bottom is brown and sticky with what was last cooked in it';
  if (state === 'residue') return 'the bottom is dark and dried on, and will need scouring';
  return null;
}
