// Street cred: the pure arithmetic. No imports, no I/O, so regress can test it directly.
//
// Cred is one hidden number per player, 0 to CRED_MAX. It's what the black market has heard about you.
// Each contact also keeps their own trust in you (their `flags.trust_flag`, raised by vendor.js on every
// sale); cred only rises when that trust crosses a step, so buying fifty joints doesn't farm it.

export const CRED_MAX = 100;
export const STEP = 25;               // a contact's trust is counted in steps of this size
export const HALF_LIFE_DAYS = 60;     // cred drifts back toward 0 when you stop showing up

const DAY_MS = 24 * 60 * 60 * 1000;

// Cred as it stands now, from the stored value and when it was stored.
export function decayCred(stored, at, now, halfLifeDays = HALF_LIFE_DAYS) {
  const v = Number(stored) || 0;
  if (v <= 0 || !at || now <= at) return Math.max(0, v);
  const days = (now - at) / DAY_MS;
  return v * Math.pow(0.5, days / halfLifeDays);
}

// Which step a contact's trust has reached.
export function trustStep(trust, step = STEP) {
  return Math.max(0, Math.floor((Number(trust) || 0) / step));
}

// Cred earned by a contact's trust moving from one step to a higher one.
export function credForSteps(fromStep, toStep, perStep) {
  return toStep > fromStep ? (toStep - fromStep) * perStep : 0;
}

export function addCred(current, gain) {
  return Math.min(CRED_MAX, Math.max(0, current + gain));
}

// How a contact sees you: their own trust, plus what they've heard, discounted by how little they care
// for outsiders. `wary` is 0 (cred counts in full) to 1 (cred counts for nothing).
export function standing(ownTrust, cred, wary = 0) {
  const w = Math.min(1, Math.max(0, Number(wary) || 0));
  return (Number(ownTrust) || 0) + (Number(cred) || 0) * (1 - w);
}

// The trust a contact starts you on when you've never dealt: what they've heard, discounted the same way.
export function seedTrust(cred, wary = 0) {
  return Math.floor(standing(0, cred, wary));
}

// The band a contact's greeting comes from.
export function band(value) {
  if (value >= 40) return 'trusted';
  if (value >= 10) return 'known';
  return 'stranger';
}
