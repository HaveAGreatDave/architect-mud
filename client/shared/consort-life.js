// client/shared/consort-life.js
//
// A kept companion's day, worked out from their id and the game clock, the way
// cat-life.js works out a cat's. Nothing here is stored or ticked: the same id at
// the same minute gives the same answer on the server and on any client, so the
// text world and anything that draws them can agree without a message.
//
// Needs (hunger, loneliness) are worked out from two timestamps when read, never
// counted down: when they last ate, and when their keeper last spent time with
// them. Pure: no imports, no I/O.

// FNV-1a with murmur3's finaliser, so ids that differ in a last digit don't cluster.
function hashOf(s) {
  let h = 0x811c9dc5;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

// The day, as blocks of game minutes from midnight. `spot` is the kind of furniture
// they'd be at, for anything that wants to put them somewhere.
// Each person runs early or late by up to an hour and a half (their own shift), and
// the free afternoon block is one of four things, picked per person per day.
const DAY = [
  { from: 0,    act: 'sleep',  spot: 'bed' },
  { from: 450,  act: 'wake',   spot: 'kitchen' },
  { from: 510,  act: 'wash',   spot: 'bath' },
  { from: 570,  act: 'tidy',   spot: null },
  { from: 660,  act: 'free',   spot: null },
  { from: 780,  act: 'lunch',  spot: 'kitchen' },
  { from: 840,  act: 'free2',  spot: null },
  { from: 1020, act: 'cook',   spot: 'kitchen' },
  { from: 1110, act: 'eat',    spot: 'table' },
  { from: 1170, act: 'screen', spot: 'sofa' },
  { from: 1320, act: 'bath',   spot: 'bath' },
  { from: 1380, act: 'sleep',  spot: 'bed' },
];
const FREE = [
  { act: 'read',     spot: 'chair' },
  { act: 'exercise', spot: null },
  { act: 'nap',      spot: 'bed' },
  { act: 'window',   spot: 'window' },
];

export const CONSORT_ACTS = ['sleep', 'wake', 'wash', 'tidy', 'read', 'exercise', 'nap', 'window', 'lunch', 'cook', 'eat', 'screen', 'bath'];

// What they're doing at `minutes` (0..1439) on game day `day`.
export function consortDay(id, minutes, day = 0) {
  const h = hashOf(id);
  const shift = (h % 181) - 90;                       // -90..+90 minutes
  const m = (((Math.round(minutes) - shift) % 1440) + 1440) % 1440;
  let b = DAY[0];
  for (const blk of DAY) if (m >= blk.from) b = blk;
  if (b.act === 'free' || b.act === 'free2') {
    const f = FREE[hashOf(id + ':' + day + ':' + b.act) % FREE.length];
    return { act: f.act, spot: f.spot, asleep: f.act === 'nap' };
  }
  return { act: b.act, spot: b.spot, asleep: b.act === 'sleep' };
}

// How hungry and how lonely, 0..1 each, from real-time stamps (ms).
// Hungry from about ten hours after a meal; at 1 by thirty. Lonely from six hours
// without their keeper; at 1 by three days.
export const HUNGRY_AT = 0.3, STARVING_AT = 0.9, LONELY_AT = 0.35;
export function consortNeeds(fedAt, seenAt, now = Date.now()) {
  const H = 3_600_000;
  const sinceFed = Math.max(0, now - (Number(fedAt) || now));
  const sinceSeen = Math.max(0, now - (Number(seenAt) || now));
  const hunger = Math.min(1, Math.max(0, (sinceFed - 6 * H) / (24 * H)));
  const lonely = Math.min(1, Math.max(0, (sinceSeen - 6 * H) / (66 * H)));
  return { hunger, lonely, hungry: hunger >= HUNGRY_AT, starving: hunger >= STARVING_AT, isLonely: lonely >= LONELY_AT };
}
