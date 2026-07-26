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
  FOND_RESIDUE_PENALTY, FOND_LIFE_MS,
} from './config.js';
import { bandIndex } from './profiles.js';

// Does this cook leave anything in the pan? A cut browned in a dry-ish pan
// does; a broth boiled in a pot does not, and neither does a ruined sear.
export function leavesFond({ vesselKind, profiles = [], band, hadLiquid = false }) {
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
export function fondModifier(fond, { deglazed = false, now = Date.now() } = {}) {
  const state = fondState(fond, now);
  if (state === 'fresh') return deglazed ? FOND_BONUS : 0;
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
