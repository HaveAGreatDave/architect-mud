// Portions — a fraction of an ingredient, and the arithmetic that keeps it
// honest.
//
// The whole feature rests on one invariant: PORTIONS CONSERVE. Cutting an onion
// into four gives you four quarters, which weigh what the onion weighed and feed
// you what the onion fed you. Nothing is created by holding a knife.
//
// What chopping DOES buy you is time: cook duration scales with weight, so a
// quartered potato finishes in a quarter of the time and can be made to land
// alongside something fast. That's the tactical use, and it's why the knife is
// worth carrying beyond the prep gate.
import { PORTION_NAMES, MIN_PORTION } from './config.js';

// The fraction of a whole ingredient this row represents. Unportioned rows are
// whole, which is 1 — so every existing item in the game is already correct.
export const portionOf = row => {
  const p = Number(row?.custom_data?.portion);
  return Number.isFinite(p) && p > 0 && p < 1 ? p : 1;
};

export const isWhole = row => portionOf(row) === 1;

// Can this be cut again, or is it already as small as the system goes?
export const canChop = (row, pieces) => portionOf(row) / pieces >= MIN_PORTION - 1e-9;

// "half an onion", "a quarter of a potato". Falls back to a plain fraction for
// any size without a word, so an odd division never renders as "[object]".
export function portionName(row, baseName) {
  const p = portionOf(row);
  if (p === 1) return baseName;
  const word = PORTION_NAMES[p];
  return word ? `${word} ${aOrAn(baseName)}` : `${fractionText(p)} of ${aOrAn(baseName)}`;
}

const aOrAn = name => (/^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`);
const fractionText = p => {
  const denom = Math.round(1 / p);
  return `1/${denom}`;
};

// What a set of ingredients yields, as a multiple of the same dish made from
// whole ones. Half an onion still SATISFIES "one soft vegetable" — quantity in a
// recipe is coarse — but the meal that comes out is smaller, and that is what
// closes the loop against chopping for free food.
export function yieldOf(rows) {
  const real = rows.filter(r => r);
  if (!real.length) return 1;
  const total = real.reduce((a, r) => a + portionOf(r), 0);
  return Math.round((total / real.length) * 100) / 100;
}
