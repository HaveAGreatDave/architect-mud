// Everything that reads or writes a vessel's `player_inventory.custom_data`.
//
// One module owns the JSON shape so nothing else hand-rolls a spread-merge and
// quietly drops a key. The shape:
//
//   {
//     mixing:  [ { item_id, name, profile, pours, abv, band } ],  // the build
//     drink:   { key, name, band, servings, capacity, thirst,
//                sanity, potency, hot_at, made_at, contaminated },
//     dirty:   true,          // set on the last swallow
//     residue: 'coffee_base', // what it last held
//     fluid_amount / fluid_type — NOT ours. plugins/fillable owns those.
//   }
//
// THE INVARIANT: a vessel holds either fillable's plain fluid or our `drink`,
// never both. `mix` folds any water in the vessel into the build and zeroes the
// fluid, which is why FLUID_RATES never had to learn about anything but water.

import { query } from '../../server/models/db.js';
import { HOT_PEAK_MS, HOT_COLD_MS, HOT_COLD_PENALTY, INSULATED_MULT } from './config.js';

export const isDrinkware = row => !!(row?.tags || {}).drinkware;
export const drinkwareKind = row => {
  const k = (row?.tags || {}).drinkware_kind;
  return typeof k === 'string' && k ? k : null;
};
export const isInsulated = row => !!(row?.tags || {}).insulated;

// How many servings this vessel holds. Reuses `tags.fillable` — the capacity a
// vessel already declares for water is the same capacity it has for anything
// else, and giving drinkware a second capacity number to disagree with itself
// would be a bug waiting to happen.
export function capacityOf(row) {
  const n = Number((row?.tags || {}).fillable);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 2;
}

export const readVessel = row => (row?.custom_data && typeof row.custom_data === 'object') ? row.custom_data : {};
export const buildOf = row => { const b = readVessel(row).mixing; return Array.isArray(b) ? b : []; };
export const drinkOf = row => readVessel(row).drink || null;
export const isDirty = row => !!readVessel(row).dirty;
export const residueOf = row => readVessel(row).residue || null;

// Merge a patch into custom_data in one statement. Postgres does the merge, so
// two writers can't clobber each other's unrelated keys the way a read-modify-
// write from JS would.
async function patch(invId, obj) {
  await query(
    `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $2::jsonb WHERE id=$1`,
    [invId, JSON.stringify(obj)]);
}

async function dropKeys(invId, keys) {
  await query(
    `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) - $2::text[] WHERE id=$1`,
    [invId, keys]);
}

export async function writeBuild(invId, build) {
  await patch(invId, { mixing: build });
}

export async function clearBuild(invId) {
  await dropKeys(invId, ['mixing']);
}

/**
 * Stamp a finished drink. Clears the build and any leftover plain fluid in the
 * same breath — the invariant is enforced here rather than trusted elsewhere.
 */
export async function writeDrink(invId, drink) {
  await dropKeys(invId, ['mixing', 'fluid_amount', 'fluid_type', 'dirty']);
  await patch(invId, { drink });
}

/**
 * Take one serving. Returns the remaining count. At zero the drink is gone and
 * the vessel is left DIRTY, carrying what it held as `residue` — which is the
 * whole reason a mop-equivalent (a rinse at any sink) is worth the ten seconds.
 */
export async function takeServing(invId, drink) {
  const left = Math.max(0, (Number(drink?.servings) || 0) - 1);
  if (left > 0) {
    await patch(invId, { drink: { ...drink, servings: left } });
    return left;
  }
  await dropKeys(invId, ['drink']);
  await patch(invId, { dirty: true, residue: drink?.residue || drink?.key || null });
  return 0;
}

export async function rinse(invId, { thorough }) {
  await dropKeys(invId, thorough ? ['dirty', 'residue'] : ['dirty']);
}

/**
 * How much a hot drink is still worth, as a multiplier on its restores.
 *
 * PURE: `now` is injected so regress can assert the curve without waiting
 * twenty minutes, and so nothing here depends on a clock the tests can't move.
 * A drink that was never hot (`hot_at` null) is always 1 — a cold drink cannot
 * get colder, and nothing punishes iced tea for being iced.
 */
export function hotMultiplier(hotAt, insulated = false, now = Date.now()) {
  if (!hotAt) return 1;
  const peak = HOT_PEAK_MS * (insulated ? INSULATED_MULT : 1);
  const cold = HOT_COLD_MS * (insulated ? INSULATED_MULT : 1);
  const age = now - hotAt;
  if (age <= peak) return 1;
  if (age >= cold) return HOT_COLD_PENALTY;
  const t = (age - peak) / (cold - peak);          // 0..1 across the cooling ramp
  return 1 - t * (1 - HOT_COLD_PENALTY);
}

// What the cup reads as right now, for examine and for the drink line.
export function temperatureNote(drink, insulated, now = Date.now()) {
  if (!drink?.hot_at) return null;
  const m = hotMultiplier(drink.hot_at, insulated, now);
  if (m >= 0.99) return 'steaming';
  if (m >= 0.8) return 'hot';
  if (m >= 0.6) return 'cooling';
  return 'stone cold';
}
