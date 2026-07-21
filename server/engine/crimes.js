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
  drug_use:            { label: 'Illegal drug use (on camera)', stars: 0.5, witness: 'camera', description: 'Using a controlled substance in view of a camera.' },
  drug_dealing:        { label: 'Dealing (hand-to-hand)',       stars: 1,   witness: 'any',    description: 'Passing a controlled substance to another person. A camera might catch it; a bystander might phone it in — never a sure thing, never zero.' },
  public_intoxication: { label: 'Visibly wrecked in public',    stars: 0.5, witness: 'any',    description: 'Not the act of using but the state of it — walking the street obviously off your head on something illegal. Anyone can phone that in, and it charges at most once every few minutes however long you stay out there.' },
  attack_player:       { label: 'Attacking a player',           stars: 4,   witness: 'any',    description: 'Opening fire on another player in view of a witness (camera, cop, or bystander) inside city limits — an immediate 4-star response.' },
  attack_npc:          { label: 'Attacking an NPC',             stars: 4,   witness: 'any',    description: 'Assaulting a non-player character in view of a witness inside city limits — an immediate 4-star response.' },
  kill_police:         { label: 'Killing police',               stars: 5,   witness: 'always', description: 'Killing a law-enforcement NPC.' },
  hacking:             { label: 'Hacking',                      stars: 2,   witness: 'any',    description: 'Breaching a device or terminal.' },
  murder:              { label: 'Murder',                       stars: 5,   witness: 'always', description: 'Killing another player outright.' },
  theft:               { label: 'Theft',                        stars: 1.5, witness: 'any',    description: 'Pickpocketing or stealing a personal item.' },
  robbery:             { label: 'Robbery',                      stars: 2.5, witness: 'any',    description: 'Forcibly robbing another player at gunpoint.' },
  atm_robbery:         { label: 'ATM robbery',                  stars: 2,   witness: 'always', description: "Draining a compromised ATM's cash reserve." },
  burglary:            { label: 'Burglary',                     stars: 2,   witness: 'any',    description: 'Breaking into a private residence.' },
  vandalism:           { label: 'Vandalism',                    stars: 1,   witness: 'any',    description: 'Destroying or defacing property.' },
  graffiti:            { label: 'Graffiti',                     stars: 0.3, witness: 'any',    description: 'Tagging a wall or surface.' },
  arson:               { label: 'Arson',                        stars: 4,   witness: 'any',    description: 'Setting a fire in an occupied structure.' },
  kidnapping:          { label: 'Kidnapping',                   stars: 4,   witness: 'any',    description: 'Restraining another player against their will.' },
  resisting_arrest:    { label: 'Resisting arrest',              stars: 2,   witness: 'always', description: 'Fighting or fleeing a lawful police detainment.' },
  evading_police:      { label: 'Evading police',                stars: 1,   witness: 'any',    description: 'Fleeing an active police pursuit.' },
  weapon_brandish:     { label: 'Brandishing a weapon',          stars: 1,   witness: 'any',    description: 'Drawing a weapon in public.' },
  public_intoxication: { label: 'Public intoxication',           stars: 0.5, witness: 'any',    description: 'Stumbling drunk or high in plain view.' },
  indecent_exposure:   { label: 'Indecent exposure',             stars: 0.5, witness: 'any',    description: 'Public indecency.' },
  curfew_violation:    { label: 'Curfew violation',              stars: 1,   witness: 'any',    description: 'Wandering outdoors during an active lockdown.' },
  looting:             { label: 'Looting',                       stars: 1,   witness: 'any',    description: 'Looting a corpse in view of a witness.' },
  contraband_possession: { label: 'Contraband possession',       stars: 1,   witness: 'any',    description: 'Carrying illicit goods past a checkpoint or scanner.' },
  manufacturing:       { label: 'Manufacturing a controlled substance', stars: 4, witness: 'any', description: 'Caught carrying raw drug material — precursors, feedstock, seeds. A manufacturing felony, well past mere possession.' },
  trespassing:         { label: 'Trespassing',                   stars: 0.5, witness: 'any',    description: 'Entering restricted or private property uninvited.' },
  reckless_endangerment: { label: 'Reckless endangerment',       stars: 3,   witness: 'any',    description: 'Crashing or ditching an aircraft into an inhabited area.' },
  manslaughter:        { label: 'Manslaughter',                  stars: 4,   witness: 'always', description: 'Killing bystanders through the reckless operation of an aircraft.' },
  jamming_signal:      { label: 'Signal jamming',                stars: 1.5, witness: 'camera', description: "Jamming a security network's transmission." },
  broadcast_piracy:    { label: 'Broadcast piracy',             stars: 3.5, witness: 'always', description: 'Hijacking a station’s media deck and seizing its frequency — a citywide signal takeover reports itself the moment it airs.' },
  bribery_attempt:     { label: 'Attempted bribery',              stars: 0.5, witness: 'camera', description: 'Attempting to bribe an officer on camera.' },
};

let overrides = {}; // key → stars (from DB)
let disabled = new Set(); // keys an admin has switched OFF (from DB)

export async function reloadCrimes() {
  overrides = {};
  disabled = new Set();
  try {
    const { rows } = await query('SELECT id, stars, enabled FROM crimes');
    for (const r of rows) { overrides[r.id] = Number(r.stars); if (r.enabled === false) disabled.add(r.id); }
  } catch {
    // Pre-migration DB (no `enabled` column yet) — fall back to stars-only so star
    // overrides still apply; every crime stays enabled until db:schema adds the column.
    try {
      const { rows } = await query('SELECT id, stars FROM crimes');
      for (const r of rows) overrides[r.id] = Number(r.stars);
    } catch { /* table not present at all — engine defaults stand */ }
  }
}

// Stars for a crime key: DB override if present, else the shipped default, else 0.
export function getCrimeStars(key) {
  if (key in overrides) return overrides[key];
  return CRIME_DEFAULTS[key]?.stars ?? 0;
}

// Whether a crime key is switched on. Admins toggle crimes in the Crime panel; a
// disabled crime never charges stars/heat (raiseCrime short-circuits on it).
export function isCrimeEnabled(key) {
  return !disabled.has(key);
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
    enabled: !disabled.has(id),
    is_default: !(id in overrides),
  }));
}
