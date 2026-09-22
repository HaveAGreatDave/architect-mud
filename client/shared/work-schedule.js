// WHEN SOMEBODY IS ON SHIFT — the arithmetic of one `vendor_schedule` block.
//
// `vendor_schedule` is `{ mon: [{from, to}, …], … }` in GAME hours, and it is carried by every
// employed NPC in the world rather than only by shopkeepers — it is the commute timetable as much
// as it is the opening hours. Five things read a block (the work test, the reopening countdown, the
// shift alarm, the dev panel's grid and its status column, and two prose formatters), and until
// this file existed each of them spelled out `h >= (b.from ?? 0) && h < (b.to ?? 24)` for itself.
//
// ── ⚠ A BLOCK MAY CROSS MIDNIGHT, AND `to < from` IS HOW IT SAYS SO ──────────
//
// It could not, until now, and the failure was the worst shape available: `{ from: 18, to: 6 }` is
// how anybody writes a night shift, `h >= 18 && h < 6` is false at EVERY hour of the day, and so it
// meant NO SHIFT AT ALL. Not an error, not a warning — a schedule that reads full and is empty, on
// an NPC who is then simply never behind their counter, which is indistinguishable from an NPC who
// is late. `ai-behaviour.js` even said so in a comment beside `isVendorClosed`, contrasting it with
// the dealer plugin's own window, which has wrapped since it was written. Two grammars for one idea
// with nothing announcing which one you were in.
//
// ⚠ **THE WRAP TEST IS STRICTLY `to < from`, NEVER `to <= from`.** `{ from: 0, to: 24 }` is the
// all-day form ~120 vendors are authored with (24 < 0 is false, so it is untouched), and
// `{ from: h, to: h }` is an EMPTY block today — `h >= 9 && h < 9` is never true — which under a
// `<=` test would silently become a 24-hour shift. A block that means nothing has to go on meaning
// nothing, or this change rewrites schedules nobody edited.
//
// ── ⚠ A WRAPPING BLOCK BELONGS TO THE DAY IT STARTS ON ───────────────────────
//
// This is the whole of what makes it more than one comparison. `mon: [{ from: 18, to: 6 }]` covers
// Monday 18:00 to TUESDAY 06:00, so at 02:00 on Tuesday the person on shift is working a block
// filed under Monday — and a test that reads only today's blocks says they are off. So the work
// test asks today's blocks for the part BEFORE midnight (`hourInBlock`) and yesterday's for the
// part after it (`hourInSpill`), which are two different questions about the same block and are
// deliberately two functions rather than one with a flag.
//
// ⚠ **`dayHasSchedule` STILL MEANS "today has blocks of its own"** and is not widened by the spill.
// Its one consumer is CHECK_VENDOR_WORK's day-off branch, which only runs when `working` is already
// false — so during a spill the NPC is working and never reaches it, and once the spill ends a day
// with no blocks is a day off, which is exactly what it was before.
//
// Loaded by the server as an ES module and by the dev panel as one that stamps `window.WorkSchedule`
// on its way out (the `drug-fx.js` idiom), because the dev panel's scripts are classic and cannot
// import — and a second copy of this arithmetic over there is how the grid and the engine end up
// disagreeing about whether somebody is at work.

/** Schedule keys, indexed the way `dayOfWeek % 7` lands (ISO 1=Mon…7=Sun ⇒ 0=Sun…6=Sat). */
export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The two ends of a block, with the defaults every reader used to spell out for itself. */
export function blockRange(b) {
  return { from: b?.from ?? 0, to: b?.to ?? 24 };
}

/** Does this block run past midnight into the following day? */
export function blockWraps(b) {
  const { from, to } = blockRange(b);
  return to < from;
}

/** How many hours long, wrap included. An empty block is 0 and stays 0. */
export function blockHours(b) {
  const { from, to } = blockRange(b);
  return to > from ? to - from : to < from ? (24 - from) + to : 0;
}

/**
 * Is `hour` inside this block, on the day the block is FILED under?
 *
 * For a wrapping block this is only the evening half — the morning half belongs to the next day and
 * is `hourInSpill`'s question. Asking one function for both would need the day as well as the hour,
 * and every caller that has the day already knows which of the two it is asking.
 */
export function hourInBlock(b, hour) {
  const { from, to } = blockRange(b);
  if (to > from) return hour >= from && hour < to;
  if (to < from) return hour >= from;          // wraps: from `from` to midnight
  return false;                                 // from === to: an empty block, as it always was
}

/** Is `hour` inside the part of this block that fell past midnight, i.e. on the NEXT day? */
export function hourInSpill(b, hour) {
  const { from, to } = blockRange(b);
  return to < from && hour < to;
}

/**
 * Is this schedule on shift at `hour` on day `todayIdx` (0=Sun…6=Sat)?
 *
 * The one place today's blocks and yesterday's spill are put together, so nothing downstream has to
 * remember that a night shift is filed a day early.
 */
export function workingAt(schedule, todayIdx, hour) {
  const sched = schedule || {};
  const today = sched[DAY_KEYS[todayIdx]] || [];
  if (today.some((b) => hourInBlock(b, hour))) return true;
  const yesterday = sched[DAY_KEYS[(todayIdx + 6) % 7]] || [];
  return yesterday.some((b) => hourInSpill(b, hour));
}

/**
 * Every (dayOffset, hour) cell a block covers — 0 for its own day, 1 for the morning after.
 *
 * For the dev panel's grid, which paints hours rather than blocks. ⚠ Without the offset a wrapping
 * block fills NO cells, the grid draws an empty week for a schedule that is not empty, and saving
 * that grid writes the empty week back: a silent deletion, which is the one thing a read-only
 * display turning into an editor must not do.
 */
export function blockCells(b) {
  const { from, to } = blockRange(b);
  const out = [];
  if (to > from) { for (let h = from; h < to; h++) out.push([0, h]); return out; }
  if (to < from) {
    for (let h = from; h < 24; h++) out.push([0, h]);
    for (let h = 0; h < to; h++) out.push([1, h]);
  }
  return out;
}

// The dev panel loads this as a module purely for the side effect; its own panel scripts are
// classic and reach the arithmetic through the global.
if (typeof window !== 'undefined') {
  window.WorkSchedule = { DAY_KEYS, blockRange, blockWraps, blockHours, hourInBlock, hourInSpill, workingAt, blockCells };
}
