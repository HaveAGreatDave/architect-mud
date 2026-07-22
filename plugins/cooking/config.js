// Tunable balance knobs for the cooking system — weight/thaw-based duration
// math and the generic (non-item-specific) stage narration. Plugin-local
// config, same choice as the preservation system's decay rates.

export const COOK_SECONDS_PER_KG = 90;   // a 1kg cut takes 90s on a 1.0x (low) stove
export const THAW_SECONDS_PER_KG = 45;   // frozen food thaws before the cook clock starts

// Appliance speed multipliers — higher is faster.
export const STOVE_SPEED = { low: 1.0, mid: 1.5, high: 2.5 };
export const PORTABLE_OVEN_SPEED = 0.8;   // slower than even the low-end stove
export const PORTABLE_OVEN_CAPACITY_G = 1500; // hard cap — "small amounts only"

// Generic stage narration, shared by every food item (no item-specific text).
// Checked top-down by elapsed fraction of the relevant segment; first match wins.
export const THAW_STAGES = [
  { max: 0.5, text: 'still frozen solid' },
  { max: 1.0, text: 'thawing out, edges gone soft' },
];
export const COOK_STAGES = [
  { max: 0.20, text: 'raw, glistening' },
  { max: 0.45, text: 'starting to sizzle at the edges' },
  { max: 0.70, text: 'browning nicely, the smell filling the room' },
  { max: 1.00, text: 'cooked through, a faint char forming' },
];

export function stageText(stages, fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  for (const s of stages) if (f <= s.max) return s.text;
  return stages[stages.length - 1].text;
}
