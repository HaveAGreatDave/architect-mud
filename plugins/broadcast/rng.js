// ── Deterministic seeding primitives (shared by the live show assemblers) ─────
// Every live-assembled show is a pure function of a time bucket: the episode's
// outcome AND its wording are generated from a seed, so all TVs render an
// identical broadcast at the same instant with no per-episode DB rows.
//
// These five helpers are PURE — no module state, no clock, no world reads — which
// is why they live here rather than in index.js: gameshow.js needs them too, and
// importing them from index.js would be circular. The slot-clock functions
// (sportsSlotOfDay and friends) stay in index.js because they read the
// environment state; callers that need a slot pass it in as an argument.
//
// Names keep the `sports` prefix because that's where they were born and every
// existing call site uses it — renaming would be a large diff for no gain.

// mulberry32.
export function sportsRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-style integer hash, for deriving a seed from a set of numbers.
export function sportsHash(...nums) {
  let h = 2166136261 >>> 0;
  for (const n of nums) { h = Math.imul(h ^ (n >>> 0), 16777619); }
  return h >>> 0;
}

// A pool pick, chatter, and the shuffle all draw from a supplied rng so the same
// seed yields the same words in the same order (rand defaults to Math.random only
// for any legacy caller — the live-show paths always thread a seeded rng).
export function sportsPick(pools, rand, ...keys) {
  for (const k of keys) {
    const arr = pools[k];
    if (Array.isArray(arr) && arr.length) return arr[Math.floor(rand() * arr.length)];
  }
  return null;
}

export function sportsFill(line, tok) {
  return line.replace(/\{(\w+)\}/g, (_, k) => (tok[k] !== undefined && tok[k] !== null ? String(tok[k]) : ''));
}

export function sportsShuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Seed a bucket-scoped rng from a string key (e.g. `${broadcastId}:gameshow:${bucket}`),
// so one line gives you the same stream on every TV for the whole bucket.
export function seedFromKey(key) {
  return sportsRng(sportsHash(...[...String(key)].map(c => c.charCodeAt(0))));
}
