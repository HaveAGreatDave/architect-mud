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
// REROLL: a player may regenerate the whole catalogue once a GAME DAY. That's the
// only scarcity mechanism here — the roster is otherwise unlimited, so the
// cooldown is the only thing stopping someone spinning it until a Ghost falls
// out. At ten minutes it wasn't stopping anybody.
//
// PRICING has three inputs and one modifier:
//   archetype.tier  — how rare/desirable the personality is       (0–3)
//   build.tier      — how rare the physicality is                 (0–2)
//   pairing.tier    — the premium on an inseparable pair          (4–5)
//   loyalty         — tenure discount, applied at billing time
// The result is deliberately steep. Keeping someone is meant to be a genuine
// drain on a rich player, not a line item a mid-game player forgets about.

import { rngFor, generateAppearance, appearanceCard, describeAppearance, intimateCard, intimateHeadline, BUILDS } from './appearance.js';
import { ARCHETYPES, PAIRINGS, temperamentOf, voiceSamples } from './archetypes.js';
import { realSecondsFor } from '../../server/engine/clock.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
export const ROSTER_SIZE = 6;             // listings shown at once

// A REGISTER REFRESH IS A DAY'S WAIT. The register is the Syndicate's stock, and
// stock does not turn over because somebody kept pressing the button — the old
// ten-minute cooldown meant a patient player could spin until the exact placement
// they wanted fell out, which made the whole seeded catalogue decorative.
//
// It's a GAME day, resolved through the world's time scale, so it costs what a
// day costs in this world rather than a fixed wall-clock number. Derived on read
// rather than frozen at import, because the time scale can be changed at runtime.
export const REROLL_COOLDOWN_GAME_MINUTES = 1440;
export function rerollCooldownMs() {
  return Math.max(60_000, realSecondsFor(REROLL_COOLDOWN_GAME_MINUTES) * 1000);
}

// Pairings are the rare high end and are meant to feel like finding one. Rolled
// ONCE PER REGISTER rather than per slot: the old per-slot 18% put a pair on
// roughly two rosters in three, which is not what "rare" means.
const PAIRING_ROSTER_CHANCE = 0.16;   // odds a whole register carries a pair at all
const MAX_PAIRINGS          = 1;      // ...and never more than one when it does

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
function buildSingle(seed, taken, sex = null) {
  const rng = rngFor(`single:${seed}`);
  const archetypeKey = rng.pick(Object.keys(ARCHETYPES));
  const arch = ARCHETYPES[archetypeKey];
  // `sex` is forced by the register's balance plan (see generateRoster). Left
  // null — as the pairing generator leaves it — it falls out of the seed.
  const look = generateAppearance(`${seed}:look`, sex ? { sex } : {});
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
//
// TWO THINGS THE SEED IS NOT TRUSTED WITH:
//
// 1. THE SEX SPLIT. Rolling a coin per slot is how a register comes out five
//    women and one man, and a player who wants men then has to burn a refresh —
//    which now costs a day. So the register is built to a PLAN: half and half,
//    with the odd slot going either way, shuffled so the order still looks
//    incidental. Everything else about a placement is still seeded; only the
//    number of each is decided.
// 2. HOW MANY PAIRS. Rolled once for the whole register, capped at one.
export function generateRoster(rosterSeed) {
  const rng = rngFor(`roster:${rosterSeed}`);
  const taken = new Set();

  const pairCount = rng.chance(PAIRING_ROSTER_CHANCE) ? MAX_PAIRINGS : 0;
  const singleCount = ROSTER_SIZE - pairCount;

  // The balance plan: as close to even as the slot count allows, then shuffled.
  const half = Math.floor(singleCount / 2);
  const plan = [
    ...Array(half).fill('female'),
    ...Array(half).fill('male'),
    ...(singleCount % 2 ? [rng.chance(0.5) ? 'female' : 'male'] : []),
  ];
  for (let i = plan.length - 1; i > 0; i--) {     // seeded Fisher-Yates
    const j = rng.int(0, i);
    [plan[i], plan[j]] = [plan[j], plan[i]];
  }

  const out = [];
  for (let i = 0; i < singleCount; i++) out.push(buildSingle(`${rosterSeed}:${i}`, taken, plan[i]));
  for (let i = 0; i < pairCount; i++) out.push(buildPair(`${rosterSeed}:p${i}`, taken));

  // Interleave so the pair isn't always pinned to the bottom of the register.
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// How the register sections itself in the app. A pairing is its own section
// because it is one indivisible product regardless of who's in it — sorting a
// mixed-sex pair under "women" or "men" would be a lie either way.
export function rosterSections(listings) {
  const sectionOf = (l) => l.kind === 'pairing' ? 'pairs'
    : l.members[0].appearance.sex === 'male' ? 'men' : 'women';
  return [
    { key: 'women', label: 'Women', ids: listings.filter(l => sectionOf(l) === 'women').map(l => l.id) },
    { key: 'men',   label: 'Men',   ids: listings.filter(l => sectionOf(l) === 'men').map(l => l.id) },
    { key: 'pairs', label: 'Matched pairs', ids: listings.filter(l => sectionOf(l) === 'pairs').map(l => l.id) },
  ].filter(s => s.ids.length);
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
    members: listing.members.map(m => {
      const t = temperamentOf(m.archetypeKey);
      return {
        name: m.name,
        sex: m.appearance.sex,
        // What they'd call themselves — NOT 'strategist'. The archetype key never
        // reaches the player; the catalogue is people advertising, not a parts bin.
        says: m.selfDescribes,
        note: m.listing,
        physical: appearanceCard(m.appearance),
        // The explicit specification. The app that renders this is MIS-gated, and
        // none of it goes anywhere near the room description.
        intimate: intimateCard(m.appearance),
        headline: intimateHeadline(m.appearance),
        // The personality half, so a buyer can tell a Ghost from an Ice BEFORE.
        // `warned` is written for every one of them on purpose — a register where
        // every entry is upside is a register nobody reads twice.
        temperament: t ? {
          traits: t.traits, warmth: t.warmth, wants: t.wants, warned: t.warned,
        } : null,
        // ...and what they actually sound like, pulled from the pools they will
        // genuinely speak from once placed. The sample IS the product.
        voice: voiceSamples(m.archetypeKey, m),
        description: describeAppearance(m.name, m.appearance),
      };
    }),
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
export function rerollState(lastRerollMs, now = Date.now(), cooldownMs = rerollCooldownMs()) {
  const elapsed = now - (lastRerollMs || 0);
  const remaining = Math.max(0, cooldownMs - elapsed);
  const mins = Math.ceil(remaining / 60_000);
  return {
    ready: remaining <= 0,
    remainingMs: remaining,
    cooldownMs,
    // A day's wait is measured in hours, not in ticking seconds.
    remainingLabel: remaining <= 0 ? 'Ready'
      : mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m`
      : `${mins}m`,
  };
}

export const _test = {
  buildSingle, buildPair, nameFor, NAMES_FEMALE, NAMES_MALE, NAMES_ANY,
  BASE_RATE, PAIR_MULT, LOYALTY_FLOOR, LOYALTY_PER_DAY,
};
