/**
 * Surgeons — who is holding the scalpel, and what that costs you.
 *
 * A surgeon is AN NPC WITH FLAGS, exactly like `flags.repairman`. That is the
 * whole design: the difference between an Ascendant specialist and a back-alley
 * cutter working out of a Promethean basement is five numbers in a content file
 * and no code at all. The zone still opts in with `flags.augment_clinic` — the
 * theatre and the person are separate, because a clinic with nobody in it should
 * refuse you, and it does.
 *
 *   flags.surgeon           true          the marker
 *   flags.surgeon_skill     0..10         their hands; drives the roll
 *   flags.surgeon_rate      0.4..1.8      price multiplier on the fitting fee
 *   flags.surgeon_risk      0.00..0.30    added complication chance
 *   flags.surgeon_licensed  1 | 0         Ascendant credentials, or none
 *
 * WHY THE ROLL IS REAL HERE. `doRepair` fakes the bench branch with
 * `Math.random() < 0.92`, and for a coat that is fine. For a spine it is not: if
 * the surgeon's competence is not a distribution, `surgeon_skill` authors
 * nothing and every cutter in the game is the same cutter at a different price.
 */
import { getZoneNpcs } from '../../server/engine/world.js';
import { relationHelp } from '../../server/engine/relations.js';

// The fitting fee is a fraction of what the hardware itself cost. Expensive
// chrome is expensive to fit; the floor keeps a cheap prosthetic from being free.
export const INSTALL_RATE = 0.25;
export const INSTALL_MINIMUM = 150;
// Pulling chrome is cheaper than fitting it, but never free — otherwise
// remove→reinstall is an unlimited re-roll of the install band.
export const REMOVE_RATE = 0.12;
export const REMOVE_MINIMUM = 100;

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** Read a surgeon's profile off their NPC flags, with sane defaults. */
export function surgeonProfile(npc) {
  const f = npc?.flags || {};
  return {
    id: npc?.id,
    name: npc?.name || 'the cutter',
    skill: Math.max(0, Math.min(10, num(f.surgeon_skill, 3))),
    rate: Math.max(0.2, Math.min(3, num(f.surgeon_rate, 1))),
    risk: Math.max(0, Math.min(0.5, num(f.surgeon_risk, 0.06))),
    licensed: f.surgeon_licensed === 0 || f.surgeon_licensed === '0' ? 0 : 1,
  };
}

/** Every surgeon in the room. Content-driven, like the repairman lookup. */
export function surgeonsIn(zoneId) {
  try {
    return (getZoneNpcs(zoneId) || []).filter(n => n?.flags?.surgeon).map(surgeonProfile);
  } catch { return []; }
}

/**
 * Pick the surgeon. Named if the player named one, otherwise the room's only
 * one. With more than one and no name we refuse rather than guessing — choosing
 * who cuts you open is the decision, not an implementation detail.
 */
export function pickSurgeon(zoneId, needle) {
  const all = surgeonsIn(zoneId);
  if (!all.length) return { error: "There's nobody here qualified to do the cutting." };
  if (needle) {
    const q = String(needle).toLowerCase();
    const hit = all.find(s => s.name.toLowerCase() === q) || all.find(s => s.name.toLowerCase().includes(q));
    if (!hit) return { error: `No surgeon here by the name of "${needle}".` };
    return { surgeon: hit };
  }
  if (all.length > 1) {
    return { error: `More than one pair of hands here: ${all.map(s => s.name).join(', ')}. Say whose.` };
  }
  return { surgeon: all[0] };
}

/** Star rendering for the quote. Half-steps read badly in a monospace pane. */
export function stars(skill) {
  const filled = Math.max(1, Math.min(5, Math.round(skill / 2)));
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

/**
 * What the difficulty of this procedure actually is. Every term is something the
 * player can see and act on before they commit — that is the point of showing a
 * risk estimate at all.
 */
export function installDifficulty(aug, { slot, itemCondition = 1, installedCount = 0, surgeon }) {
  return num(aug.install_difficulty, 5)
       + Math.log10(Math.max(10, num(aug.cost, 10)))              // grade; doRepair's own term
       + ((slot || aug.slot) === 'neural' ? 2 : 0)                 // the head is harder
       + (num(aug.licensed, 1) && surgeon && !surgeon.licensed ? 1 : 0)
       + (installedCount >= 3 ? 1 : 0)                             // a crowded body
       + (1 - Math.max(0, Math.min(1, itemCondition))) * 4;        // second-hand chrome fits worse
}

/** The price, before the roll. You are paying for the attempt, not the result. */
export function installQuote(player, surgeon, aug, { removing = false } = {}) {
  const rate = removing ? REMOVE_RATE : INSTALL_RATE;
  const floor = removing ? REMOVE_MINIMUM : INSTALL_MINIMUM;
  const base = Math.max(floor, Math.ceil(num(aug.cost, 0) * rate));
  const help = surgeon?.id ? relationHelp(player, surgeon.id) : 0;
  return Math.max(1, Math.round(base * surgeon.rate * (1 - help)));
}

/** Chance the procedure goes wrong regardless of the swing. */
export function complicationChance(player, surgeon, difficulty) {
  const help = surgeon?.id ? relationHelp(player, surgeon.id) : 0;
  const p = 0.04 + surgeon.risk
          + 0.02 * Math.max(0, difficulty - surgeon.skill)
          - 0.03 * help;
  return Math.max(0.01, Math.min(0.85, p));
}

// The house curve, same shape as skillCheck — but the SURGEON rolls it, not the
// patient. Their hands, their margin.
function roll2d8() { return Math.floor(Math.random() * 8) + 1 + Math.floor(Math.random() * 8) + 1; }

export function npcCheck(skill, difficulty) {
  const swing = roll2d8() - roll2d8();
  const margin = (skill - difficulty) + swing;
  return { swing, margin, success: margin >= 0 };
}
