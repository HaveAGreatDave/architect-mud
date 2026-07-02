/**
 * Crime registry — the canonical list of chargeable acts and how many wanted
 * stars each one carries. Keys are engine constants (referenced from combat /
 * surveillance / drug code); the star *values* are content, dev-panel editable
 * via the `crimes` table.
 *
 * Source-of-truth pattern (mirrors tunables): ship sensible defaults here so a
 * fresh DB works before any rows are authored, and let DB rows override the
 * star value. The dev panel reads getCrimeList() (defaults merged with DB) and
 * writes rows back.
 */
import { query } from '../models/db.js';

// key → { label, stars, description }. `witness` marks how the act is caught:
//   'camera'  — only a live surveillance camera counts (a bystander won't do)
//   'any'     — any witness: camera, on-duty cop, or another player in the room
//   'always'  — self-reporting; heat applies even with nobody watching
export const CRIME_DEFAULTS = {
  drug_use:      { label: 'Illegal drug use (on camera)', stars: 0.5, witness: 'camera', description: 'Using a controlled substance in view of a camera.' },
  attack_player: { label: 'Attacking a player',           stars: 3,   witness: 'any',    description: 'Opening fire on another player.' },
  attack_npc:    { label: 'Attacking an NPC',             stars: 3,   witness: 'any',    description: 'Assaulting a non-player character.' },
  kill_police:   { label: 'Killing police',               stars: 5,   witness: 'always', description: 'Killing a law-enforcement NPC.' },
  hacking:       { label: 'Hacking',                       stars: 2,   witness: 'any',    description: 'Breaching a device or terminal.' },
};

let overrides = {}; // key → stars (from DB)

export async function reloadCrimes() {
  try {
    const { rows } = await query('SELECT id, stars FROM crimes');
    overrides = {};
    for (const r of rows) overrides[r.id] = Number(r.stars);
  } catch {
    overrides = {}; // table not present yet — defaults stand
  }
}

// Stars for a crime key: DB override if present, else the shipped default, else 0.
export function getCrimeStars(key) {
  if (key in overrides) return overrides[key];
  return CRIME_DEFAULTS[key]?.stars ?? 0;
}

export function getCrimeWitness(key) {
  return CRIME_DEFAULTS[key]?.witness ?? 'any';
}

export function getCrimeLabel(key) {
  return CRIME_DEFAULTS[key]?.label ?? key;
}

// Defaults merged with DB overrides — the shape the dev panel renders/edits.
export function getCrimeList() {
  return Object.entries(CRIME_DEFAULTS).map(([id, def]) => ({
    id,
    label: def.label,
    stars: id in overrides ? overrides[id] : def.stars,
    description: def.description,
    witness: def.witness,
    is_default: !(id in overrides),
  }));
}
