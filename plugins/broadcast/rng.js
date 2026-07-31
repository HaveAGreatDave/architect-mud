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

// ── Season rosters ───────────────────────────────────────────────────────────
// A club's players for a WHOLE SEASON, dealt from the sport's name pool. Pure and
// seeded on (team, season), never on the slot — that is the entire point.
//
// Deal per GAME (which is what the sim did before this existed) and "Rodriguez"
// in slot 40 has nothing to do with "Rodriguez" in slot 45 beyond the spelling.
// Tally that and you get a leaderboard of strings. Dealing per SEASON is what
// makes a scoring race, a persistent injury, an enforcer, or a death mean
// anything at all — and it still stores nothing, because it is a function.
//
// Sport-agnostic on purpose: hockey uses it now, baseball can be retrofitted onto
// the same call later for a batting-average race, with no data migration because
// nothing about the old per-game deal was ever persisted.
export function rosterFor(team, seasonNo, pool, size = 18) {
  const names = Array.isArray(pool) && pool.length ? pool : ['Doe'];
  const rand = seedFromKey(`roster|${seasonNo}|${team}`);
  const shuffled = sportsShuffle(names, rand);
  // Wrap the pool if a club needs more bodies than the league has surnames, and
  // suffix the repeats so two men on one roster never share a name.
  return Array.from({ length: size }, (_, i) => {
    const base = shuffled[i % shuffled.length];
    return i < shuffled.length ? base : `${base} II`;
  });
}

// Who is actually available to a club at a given point in a season, given the
// casualties the fold has already harvested. The dead are struck off for good; the
// injured come back after `heal` games. Call-ups fill the gaps from the reserve
// pool, or a club bleeds out over a 30-day season.
export function availableRoster(team, seasonNo, pool, casualties = [], heal = 3) {
  const full = rosterFor(team, seasonNo, pool);
  const dead = new Set(casualties.filter(c => c.dead).map(c => c.name));
  const hurt = new Map();
  for (const c of casualties) if (!c.dead) hurt.set(c.name, (c.gamesAgo ?? 0));
  const fit = full.filter(n => !dead.has(n) && !(hurt.has(n) && hurt.get(n) < heal));
  if (fit.length >= 6) return fit;
  // Call-ups. Note these must NOT be filtered against the existing roster: a club
  // is 18 deep from a pool that may only hold 16 surnames, so "names not already
  // on the roster" is routinely empty and the club would ice four men. The suffix
  // is what keeps them distinct — and it reads correctly too, because a call-up
  // genuinely is somebody nobody has heard of who happens to share a name.
  const rand = seedFromKey(`callup|${seasonNo}|${team}|${dead.size}`);
  const spare = sportsShuffle(pool, rand).map(n => `${n} (call-up)`);
  const need = 6 - fit.length;
  return fit.concat(Array.from({ length: need }, (_, i) => spare[i % spare.length]));
}
