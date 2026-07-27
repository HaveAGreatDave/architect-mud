// plugins/consort/roster.js
//
// The B.L.I.S.S. catalogue — what's on offer, what it costs, and how often you
// may ask for a different set.
//
// A LISTING is generated entirely from a seed: archetype, appearance, name and
// price all fall out of `rosterSeed:<player>:<generation>` deterministically. So
// the roster costs nothing to store (one seed + one generation counter per
// player, in player_flags), survives a restart unchanged, and a listing shown in
// the app is guaranteed to be the same person when it's ordered a minute later.
//
// REROLL: a player may regenerate the whole catalogue on a REROLL_COOLDOWN_MS
// timer. That's the only scarcity mechanism here — the roster is otherwise
// unlimited, so the cooldown is what stops someone spinning it until a Ghost
// falls out.
//
// PRICING has three inputs and one modifier:
//   archetype.tier  — how rare/desirable the personality is       (0–3)
//   build.tier      — how rare the physicality is                 (0–2)
//   pairing.tier    — the premium on an inseparable pair          (4–5)
//   loyalty         — tenure discount, applied at billing time
// The result is deliberately steep. Keeping someone is meant to be a genuine
// drain on a rich player, not a line item a mid-game player forgets about.

import { rngFor, generateAppearance, appearanceCard, describeAppearance, BUILDS } from './appearance.js';
import { ARCHETYPES, PAIRINGS } from './archetypes.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
export const ROSTER_SIZE        = 6;             // listings shown at once
export const REROLL_COOLDOWN_MS = 10 * 60_000;   // 10 minutes between catalogue refreshes
const PAIRING_CHANCE            = 0.18;          // odds any one slot is a rare pair instead of a single

// Daily rate = BASE + archetype tier + build tier, then the pairing multiplier.
const BASE_RATE      = 900;
const ARCHETYPE_STEP = 420;    // per archetype tier point
const BUILD_STEP     = 260;    // per build tier point
const PAIR_MULT      = 2.35;   // a pair is more than two singles — they come as a unit
const RATE_JITTER    = 0.12;   // ±12% seeded wobble so two identical specs aren't identically priced

// Loyalty: the longer they stay, the cheaper they get. They want to stay, and the
// Syndicate would rather bill a small amount forever than a large amount once.
const LOYALTY_FLOOR    = 0.55;   // never drops below 55% of the base rate
const LOYALTY_PER_DAY  = 0.015;  // 1.5% off per day kept
export const LOYALTY_TIERS = [
  { days: 0,   label: 'New placement',   note: 'Full rate. No tenure yet.' },
  { days: 7,   label: 'Settled',         note: 'A week in. The Syndicate notices.' },
  { days: 21,  label: 'Established',     note: 'Three weeks. Rate materially reduced.' },
  { days: 45,  label: 'Long-standing',   note: 'Over a month. They have stopped counting the days and so has billing.' },
  { days: 90,  label: 'Permanent',       note: 'Floor rate. At this point the paperwork is a formality.' },
];

// ── Names ─────────────────────────────────────────────────────────────────────
// Deliberately ornamental working names, and everyone involved knows it. The
// female/male split is soft — the shared pool is used for either.
const NAMES_FEMALE = [
  'Bijou', 'Roxy', 'Vesper', 'Calla', 'Sable', 'Nadia', 'Ilse', 'Juno', 'Marisol',
  'Odile', 'Perrine', 'Solveig', 'Thea', 'Amaranth', 'Cerise', 'Delphine', 'Esme',
  'Gilda', 'Isolde', 'Jessamine', 'Liesl', 'Mira', 'Noor', 'Ondine', 'Pilar',
  'Rosalind', 'Sunniva', 'Tamsin', 'Ulla', 'Verity', 'Xanthe', 'Yseult', 'Zora',
  'Anouk', 'Clove', 'Etta', 'Ottoline', 'Seraphine', 'Wilhelmina', 'Lark',
];
const NAMES_MALE = [
  'Cassian', 'Emory', 'Lucian', 'Ansel', 'Dorian', 'Rafe', 'Silas', 'Tobias',
  'Caspar', 'Idris', 'Marek', 'Nikolai', 'Osric', 'Percival', 'Quentin', 'Roman',
  'Soren', 'Thaddeus', 'Ulric', 'Valentin', 'Wilder', 'Xavier', 'Yannick', 'Zephyr',
  'Auden', 'Bellamy', 'Crane', 'Dmitri', 'Ellery', 'Fennimore', 'Gideon', 'Hollis',
  'Ivo', 'Jasper', 'Konstantin', 'Leander', 'Milo', 'Navarre', 'Orsino', 'Piers',
];
const NAMES_ANY = ['Wren', 'Kestrel', 'Beau', 'Fawn', 'Quill', 'Dove', 'Bright', 'Ash', 'Rune', 'Vale'];

function nameFor(rng, sex, taken) {
  const pool = [...(sex === 'male' ? NAMES_MALE : NAMES_FEMALE), ...NAMES_ANY]
    .filter(n => !taken.has(n.toLowerCase()));
  const chosen = pool.length ? rng.pick(pool) : `Placement ${rng.int(100, 999)}`;
  taken.add(chosen.toLowerCase());
  return chosen;
}

// ── Pricing ───────────────────────────────────────────────────────────────────
export function rateFor({ archetypeKey, buildKey, sex, pairingKey, seed }) {
  const rng = rngFor(`rate:${seed}`);
  if (pairingKey) {
    const p = PAIRINGS[pairingKey];
    // A pair is priced off the pairing tier itself, not the sum of its halves —
    // it's one indivisible product with one indivisible bill.
    const base = BASE_RATE + ARCHETYPE_STEP * (p?.tier ?? 4);
    return Math.round(base * PAIR_MULT * (1 + (rng.next() * 2 - 1) * RATE_JITTER) / 25) * 25;
  }
  const aTier = ARCHETYPES[archetypeKey]?.tier ?? 1;
  const bTier = BUILDS[sex === 'male' ? 'male' : 'female'][buildKey]?.tier ?? 0;
  const base = BASE_RATE + ARCHETYPE_STEP * aTier + BUILD_STEP * bTier;
  return Math.round(base * (1 + (rng.next() * 2 - 1) * RATE_JITTER) / 25) * 25;
}

// What they actually cost you today, given how long you've kept them.
export function loyaltyMultiplier(daysKept) {
  return Math.max(LOYALTY_FLOOR, 1 - LOYALTY_PER_DAY * Math.max(0, daysKept || 0));
}
export function effectiveRate(baseRate, daysKept) {
  return Math.max(1, Math.round(baseRate * loyaltyMultiplier(daysKept) / 5) * 5);
}
export function loyaltyTier(daysKept) {
  let tier = LOYALTY_TIERS[0];
  for (const t of LOYALTY_TIERS) if ((daysKept || 0) >= t.days) tier = t;
  return tier;
}

// ── Listing generation ────────────────────────────────────────────────────────
// One listing = one orderable placement. A pairing listing carries TWO members
// and is ordered/released as a single unit.
function buildSingle(seed, taken) {
  const rng = rngFor(`single:${seed}`);
  const archetypeKey = rng.pick(Object.keys(ARCHETYPES));
  const arch = ARCHETYPES[archetypeKey];
  const look = generateAppearance(`${seed}:look`);
  const name = nameFor(rng, look.sex, taken);
  return {
    id: `L${seed}`,
    kind: 'single',
    seed,
    members: [{
      name, archetypeKey, seed: `${seed}:look`, appearance: look,
      selfDescribes: rng.pick(arch.selfDescribes),
      archetypeLabel: arch.label,
      listing: arch.listing,
    }],
    rate: rateFor({ archetypeKey, buildKey: look.build, sex: look.sex, seed }),
  };
}

function buildPair(seed, taken) {
  const rng = rngFor(`pair:${seed}`);
  const pairingKey = rng.pick(Object.keys(PAIRINGS));
  const pairing = PAIRINGS[pairingKey];
  const members = pairing.members.map((archetypeKey, i) => {
    const arch = ARCHETYPES[archetypeKey];
    const look = generateAppearance(`${seed}:look:${i}`);
    return {
      name: nameFor(rng, look.sex, taken),
      archetypeKey, seed: `${seed}:look:${i}`, appearance: look,
      selfDescribes: rng.pick(arch.selfDescribes),
      archetypeLabel: arch.label,
      listing: arch.listing,
    };
  });
  return {
    id: `L${seed}`,
    kind: 'pairing',
    seed,
    pairingKey,
    pairingLabel: pairing.label,
    pairingBlurb: pairing.blurb,
    pairingListing: pairing.listing,
    members,
    rate: rateFor({ pairingKey, seed }),
  };
}

// The whole catalogue for a given (player, generation). Pure — no DB, no clock.
export function generateRoster(rosterSeed) {
  const rng = rngFor(`roster:${rosterSeed}`);
  const taken = new Set();
  const out = [];
  for (let i = 0; i < ROSTER_SIZE; i++) {
    const slotSeed = `${rosterSeed}:${i}`;
    out.push(rng.chance(PAIRING_CHANCE) ? buildPair(slotSeed, taken) : buildSingle(slotSeed, taken));
  }
  return out;
}

// ── The listing card ──────────────────────────────────────────────────────────
// Everything the app shows about one placement: every physical characteristic,
// how they'd describe themselves (never the clinical archetype key), the price,
// and the tenure maths.
export function listingCard(listing) {
  return {
    id: listing.id,
    kind: listing.kind,
    rate: listing.rate,
    pairing: listing.kind === 'pairing' ? {
      label: listing.pairingLabel,
      blurb: listing.pairingBlurb,
      note: listing.pairingListing,
    } : null,
    members: listing.members.map(m => ({
      name: m.name,
      sex: m.appearance.sex,
      // What they'd call themselves — NOT 'strategist'. The archetype key never
      // reaches the player; the catalogue is people advertising, not a parts bin.
      says: m.selfDescribes,
      note: m.listing,
      physical: appearanceCard(m.appearance),
      description: describeAppearance(m.name, m.appearance),
    })),
    // Sample of what tenure would do to the bill, so the loyalty curve is legible
    // at the point of sale rather than a surprise a fortnight later.
    projection: [7, 21, 45, 90].map(d => ({
      days: d,
      rate: effectiveRate(listing.rate, d),
      label: loyaltyTier(d).label,
    })),
  };
}

// ── Reroll cooldown ───────────────────────────────────────────────────────────
// State is two player_flags values (see hire.js): the generation counter and the
// ms timestamp of the last reroll. This module just does the arithmetic.
export function rerollState(lastRerollMs, now = Date.now()) {
  const elapsed = now - (lastRerollMs || 0);
  const remaining = Math.max(0, REROLL_COOLDOWN_MS - elapsed);
  return {
    ready: remaining <= 0,
    remainingMs: remaining,
    remainingLabel: remaining <= 0 ? 'Ready'
      : `${Math.floor(remaining / 60000)}m ${Math.ceil((remaining % 60000) / 1000)}s`,
  };
}

export const _test = {
  buildSingle, buildPair, nameFor, NAMES_FEMALE, NAMES_MALE, NAMES_ANY,
  BASE_RATE, PAIR_MULT, LOYALTY_FLOOR, LOYALTY_PER_DAY,
};
