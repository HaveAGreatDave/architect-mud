/**
 * Zone filth — who is responsible for the floor.
 *
 * The stain half of hygiene already existed: `stainZone()` in bodily.js marks a
 * room, describe.js renders it, and dailyMaintenance wiped every zone in the game
 * clean once per game-day. That daily wipe is right for the street — nobody owns
 * the street, and a city that stayed fouled forever is just noise. It was wrong
 * for the room you pay rent on: a mess you made in your own kitchen evaporated
 * overnight whether you touched it or not, so there was nothing to be house-proud
 * about and no reason for a mop to exist.
 *
 * So filth now has two clocks. Unowned space is still wiped nightly (the city
 * cleans itself). A room somebody OWNS keeps its stains for STAIN_KEEP_DAYS game
 * days, which is one rent cycle — long enough that the only way to live somewhere
 * clean is to clean it, short enough that an abandoned flat doesn't stay a health
 * hazard forever. The 7-day sweep is a backstop for absentee owners, not a
 * service: if you're playing, you'll be mopping.
 *
 * Ownership is asked, not assumed. The engine knows about apartments, but a shop
 * deed lives in the storefront plugin and the engine must not import a plugin —
 * so plugins register a provider (same shape as registerArmorContributor in
 * commands/inventory.js) and this module ORs them together.
 *
 * Storage discipline is inherited from stainZone(): `zone.stains` lives in RAM and
 * is the source of truth. Nothing here writes the DB on a player action — cleaning
 * a room is a Map mutation, which is what lets `clean` be called from any path
 * without a round trip.
 */
import { world } from './world.js';

// One rent cycle. Deliberately the same number as RENT_PERIOD_DAYS rather than an
// import of it — these are the same duration for a thematic reason (your place is
// your responsibility for as long as you're paying for it), not a shared constant.
export const STAIN_KEEP_DAYS = 7;

// --- Ownership -------------------------------------------------------------

const ownedProviders = [];

/**
 * Register a "does a player own this zone?" answer. Called at plugin load;
 * `fn(zoneId)` must be SYNCHRONOUS and query-free — it runs once per owned zone
 * inside the daily sweep and on every clean.
 *
 * A provider may return a bare boolean (is it owned at all?) or, better, the
 * OWNER'S PLAYER ID. Returning the id costs the provider nothing and lets
 * `zoneOwnerId` answer "owned by WHOM" from the same seam — which is what gates
 * owner-only affordances (a concealment keypad you only see in your own flat).
 */
export function registerOwnedZoneProvider(fn) {
  if (typeof fn === 'function') ownedProviders.push(fn);
}

/**
 * Who owns this zone, or null. Sync and query-free by the same contract as
 * `isOwnedZone` — it runs off room description, so it must never touch the DB.
 * A provider that only answers `true` contributes ownership but no identity, and
 * an owner-gated affordance stays hidden rather than guessing.
 */
export function zoneOwnerId(zoneId) {
  if (!zoneId) return null;
  const apt = world.apartments?.get(zoneId);
  if (apt?.owner_id) return apt.owner_id;
  for (const fn of ownedProviders) {
    try {
      const r = fn(zoneId);
      if (r && r !== true) return r;
    } catch { /* a broken provider must not break a room description */ }
  }
  return null;
}

/** Does this player own this zone? False for an unowned room and for a stranger. */
export function ownsZone(zoneId, playerId) {
  if (!playerId) return false;
  const owner = zoneOwnerId(zoneId);
  return owner != null && String(owner) === String(playerId);
}

// Apartments are the engine's own answer: world.apartments is already in memory
// (loaded at boot by loadApartments), and a real tenancy always carries owner_id.
function apartmentOwned(zoneId) {
  const apt = world.apartments?.get(zoneId);
  return !!apt?.owner_id;
}

export function isOwnedZone(zoneId) {
  if (!zoneId) return false;
  if (apartmentOwned(zoneId)) return true;
  for (const fn of ownedProviders) {
    try { if (fn(zoneId)) return true; } catch { /* a broken provider must not stop the sweep */ }
  }
  return false;
}

// --- The deep-clean cadence -------------------------------------------------

// Days since the epoch for a 'YYYY-MM-DD' game date. Used only modulo
// STAIN_KEEP_DAYS, so it needs to be monotonic and stable, not calendar-correct.
// Deriving the cadence from the date rather than a counter keeps it STATELESS —
// no new column, and a restart can't reset everyone's mess.
export function gameDayIndex(ymdStr) {
  if (!ymdStr) return null;
  const t = Date.parse(`${ymdStr}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.floor(t / 86400000);
}

/**
 * Is today the game-day on which even owned rooms get swept?
 *
 * Also read by the bodily plugin for unflushed toilets, which ride this exact
 * cadence — it takes the `deepClean` flag off the `world.dailyMaintenance` event
 * rather than calling this itself, so the floor and the bowl can never drift
 * onto different schedules.
 */
export function isDeepCleanDay(ymdStr) {
  const idx = gameDayIndex(ymdStr);
  return idx === null ? true : idx % STAIN_KEEP_DAYS === 0;
}

// --- Cleaning ---------------------------------------------------------------

/** How many stain marks are on this floor right now. */
export function filthCount(zoneId) {
  const zone = world.zones.get(zoneId);
  if (!zone?.stains) return 0;
  let n = 0;
  for (const v of Object.values(zone.stains)) n += v > 0 ? v : 0;
  return n;
}

/** The stain types present, worst-first is the caller's business. */
export function filthTypes(zoneId) {
  const zone = world.zones.get(zoneId);
  if (!zone?.stains) return [];
  return Object.entries(zone.stains).filter(([, n]) => n > 0).map(([t]) => t);
}

/**
 * Scrub `marks` stain-marks off a floor, cheapest type first so a long job
 * visibly shortens. Returns how many were actually removed (0 = already clean).
 * Sync and query-free by contract — RAM is the source of truth for stains.
 */
export function cleanZone(zoneId, marks = Infinity) {
  const zone = world.zones.get(zoneId);
  if (!zone?.stains) return 0;
  let budget = marks, removed = 0;
  // Ascending count: clear the one-off splash before the big mess, so partial
  // effort reads as progress rather than as nothing having happened.
  const entries = Object.entries(zone.stains)
    .filter(([, n]) => n > 0)
    .sort((a, b) => a[1] - b[1]);
  for (const [type, n] of entries) {
    if (budget <= 0) break;
    const take = Math.min(n, budget);
    const left = n - take;
    if (left > 0) zone.stains[type] = left; else delete zone.stains[type];
    budget -= take;
    removed += take;
  }
  return removed;
}
