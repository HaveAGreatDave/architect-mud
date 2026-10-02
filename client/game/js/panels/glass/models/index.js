// Every region file of building-model arms. drawTypeModelArm (windshield.js) merges these tables
// into one lookup by m.type, so a new region file is one more line here and nothing else.
//
// Re-exports only. A table built here at load would break when a region module is the first thing
// imported (the cycle through windshield.js would reach this file before the region module had
// run), and windshield.js reads these lazily for the same reason. scripts/shapes/armtables.mjs
// fails a region file that isn't listed here.
export { OUTPOST_ARMS } from './outposts.js';
export { TWIN_PASS_ARMS } from './twin-pass.js';
export { DOWNTOWN_ARMS } from './downtown.js';
export { REACH_ARMS } from './the-reach.js';
export { YARDS_ARMS } from './yards.js';
export { WATERFRONT_ARMS } from './waterfront.js';
export { OLD_COLDWATER_ARMS } from './old-coldwater.js';
export { HALCYON_ARMS } from './halcyon-fields.js';
