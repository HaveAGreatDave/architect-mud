// The lightning the server made. Every view that shows a strike reads this list, so a bolt on screen
// is always one the sim put at that spot. Nothing in the client may invent one.
//
// A strike is { seq, gx, gy, intensity, cc, d, at }: `gx, gy` where it fell, `cc` true if it stayed
// in the cloud, `d` tiles from the player's body (null if the server couldn't say) and `at` its
// arrival on the wall clock. A view keeps the last `seq` it read and asks for what came after.

const KEEP = 32;      // a peak ion storm is about one strike a second across the whole map
const FRESH_MS = 4000; // a view that opens now doesn't replay the storm so far

const feed = [];
let seq = 0;

export function noteStrike({ gx, gy, intensity, cc, d = null }) {
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return;
  feed.push({ seq: ++seq, gx, gy, intensity: intensity ?? 0.6, cc: !!cc, d, at: Date.now() });
  if (feed.length > KEEP) feed.shift();
}

export function strikesAfter(after) {
  if (!feed.length || feed[feed.length - 1].seq <= after) return [];
  const since = Date.now() - FRESH_MS;
  return feed.filter((s) => s.seq > after && s.at >= since);
}
