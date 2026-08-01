// Tunable balance knobs for the freshness/preservation system. Everything the
// decay math needs lives here so rates can be re-balanced without touching
// decay.js. Not a content table (v1 simplicity) — see docs/systems-... (TODO)
// if this ever needs dev-panel tuning.

// Ambient temperature (°C, from getZoneTemperature) buckets into a decay tier
// even with no appliance involved — a naturally cold zone slows spoilage,
// a naturally hot one accelerates it. Checked top-down, first match wins.
export const TEMP_BUCKETS = [
  { max: 4, tier: 'frozen' },
  { max: 15, tier: 'refrigerated' },
  { max: 30, tier: 'ambient' },
  { max: Infinity, tier: 'hot' },
];

// Decay multiplier per preservation tier (lower = slower spoilage).
export const TIER_FACTOR = {
  frozen: 0.03,
  refrigerated: 0.25,
  ambient: 1.0,
  hot: 2.0,
};

// Per-item spoil_rate tag selects a further multiplier on top of the tier factor.
export const SPOIL_RATE_FACTOR = {
  fast: 1.6,
  normal: 1.0,
  slow: 0.5,
};

// A 'normal' item at 'ambient' tier fully spoils (100 -> 0) in ~48 hours.
export const BASE_DECAY_PER_HOUR = 100 / 48;

// An antioxidant dosed into the food itself (BHT — see preserve.js) multiplies
// the decay rate wherever the item happens to be sitting. Roughly "a shelf
// becomes a cold room", and it stacks with real refrigeration rather than
// replacing it.
export const ADDITIVE_FACTOR = 0.3;

// Freshness below this is rot already underway — an antioxidant slows oxidation,
// it does not undo it, so dosing is refused rather than silently wasted.
export const ADDITIVE_MIN_FRESHNESS = 25;

// Preservation-tier ranking — a stronger environment satisfies a weaker
// requirement (a freezer keeps "refrigerated" food fine).
export const TIER_RANK = { ambient: 0, refrigerated: 1, frozen: 2 };

// Minutes a fridge/freezer keeps its rated tier's benefit after power/plug is
// lost before decaying at the ambient rate instead.
export const POWER_LOSS_BUFFER_MIN = { refrigerated: 30, frozen: 180 };

// Freshness value (100 -> 0) state cutoffs, checked top-down.
export const STATE_CUTOFFS = [
  { min: 60, state: 'fresh' },
  { min: 25, state: 'aging' },
  { min: 1, state: 'spoiling' },
  { min: 0, state: 'spoiled' },
];

export function stateFor(value) {
  for (const c of STATE_CUTOFFS) if (value >= c.min) return c.state;
  return 'spoiled';
}

// Skip a checkpoint write if the recomputed value hasn't moved enough to matter —
// this is the guarantee against writing on every glance at an untouched item.
export const WRITE_DIFF_THRESHOLD = 1;
