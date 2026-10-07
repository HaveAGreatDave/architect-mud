// A CACHED CAMP DRAWS WHAT A LIVE ONE DRAWS.
//
//   node scripts/shapes/campcache.mjs
//
// `drawTentCamp` records a camp once per seed, tier, night and sun, and replays the record each frame
// (RENDER_TUNE.campCache). `campCacheSmoke` draws each camp live and from the record, over seeds,
// tiers, night and day, both shelter paths and eyes on three sides, and compares every sink. A
// mismatch is a camera term that slipped into the record, or an input the cache key doesn't carry.
//
// It went 37 mismatches unnoticed because nothing ran it: the test sun was off the 2-degree grid
// the record is made on, so the drum staves came out one RGB step apart.
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const res = ws.campCacheSmoke();

if (!res.ran) {
  console.error('✗ campcache: nothing was drawn, so nothing was compared');
  process.exit(1);
}
if (res.length) {
  console.error(`\n✗ campcache: ${res.length} cached camp(s) differ from the live camp:`);
  for (const p of res.slice(0, 20)) console.error('  · ' + p);
  if (res.length > 20) console.error(`  · …and ${res.length - 20} more`);
  console.error('\n  The record reads everything in the cache key in drawTentCamp and nothing else. A new');
  console.error('  input needs a term in the key; a camera term belongs in a campLive closure.');
  process.exit(1);
}
console.log(`✓ campcache: cached camps match live ones (${res.ran} bytes compared).`);
