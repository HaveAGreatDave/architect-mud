// ── Game-show subjects ───────────────────────────────────────────────────────
// A SUBJECT is what a game show asks about. It owns the whole vertical for its own
// questions: where the material comes from, how a round is dealt, how an answer is
// typed and parsed, and how it's scored. `gameshow.js` owns everything a game show
// has regardless of subject — the cast, the guess window, the purse, the cooldown,
// the studio-floor relay — and knows nothing about prices or districts.
//
// WHY THIS EXISTS. The material used to be hardwired to `items.value`, which was the
// right call for one show and the wrong one for two: The Last Lot and Jackpot Protocol
// would have been the same programme with a different host. A `@subject` line in the
// .bsm now picks the material, so a third show is a subject module and a script rather
// than a fork of the round loop.
//
// THE CONTRACT. Every subject is ZERO-QUERY by construction, like the pool it replaced:
// it may read the boot-loaded item cache, the world Maps and the district registry, and
// nothing else. A subject that needs a DB read is a subject that can't air — the round
// nodes are assembled on the broadcast tick, on every channel, for every set in the city.
//
// A subject exports:
//   id       — matches @subject in the .bsm
//   plan     — ordered round specs; the episode's shape. At most 4 are played.
//   episode(rand, ctx) -> { round(spec) -> roundData | null }
//   score(format, entries, round) -> winning entry | null
//   parse(format, args) -> { value, label, spoken } | null
//   hint(format) -> the one-line usage string for a malformed guess
//
// `round(spec)` returning null means "the world can't furnish this round today" — the
// caller skips it and the episode plays shorter. That is a normal outcome on a thin
// catalog, not an error.

import { world } from '../../server/engine/world.js';
import { DISTRICTS } from '../../server/engine/districts.js';
import { getItemCache } from '../../server/engine/items-cache.js';
import { sportsShuffle } from './rng.js';

const money = (n) => `${Number(n).toLocaleString('en-US')}`;

const SUBJECTS = new Map();
export function registerGameshowSubject(subject) {
  if (!subject?.id) throw new Error('gameshow subject needs an id');
  SUBJECTS.set(subject.id, subject);
  return subject;
}
// Unknown or absent @subject falls back to retail — every game show that existed before
// subjects were a concept is a retail show, and must keep airing untouched.
export function getGameshowSubject(id) {
  return SUBJECTS.get(String(id || '').toLowerCase()) || SUBJECTS.get('retail');
}
export function gameshowSubjectIds() { return [...SUBJECTS.keys()]; }

// ═════════════════════════════════════════════════════════════════════════════
// RETAIL — "what is this worth?" The original subject, behaviour unchanged.
// ═════════════════════════════════════════════════════════════════════════════

// Prize-pool sanity bounds. The floor kills 1cr placeholder junk (a crushed can is
// not a question); the ceiling is headroom over today's dearest item (9,200) so one
// future absurd row can't hijack the show.
const PRIZE_MIN_VALUE = 5;
const PRIZE_MAX_VALUE = 12000;
// Value bands, so an episode isn't four consumables in a row.
const TIER_CHEAP_MAX = 50;
const TIER_MID_MAX = 500;
// The showcase is winnable inside a band rather than closest-without-going-over —
// a finale nobody can win reads badly, and "within twenty percent" says well on air.
const SHOWCASE_BAND = 0.20;
// Over-or-under is only a question when the two lots aren't neighbours. Below this
// ratio it's a coin flip, so the pair is rejected and another is drawn.
const OVERUNDER_MIN_RATIO = 1.35;

// Fold the in-memory item catalog into a priceable pool. Deliberately NOT sourced from
// `furniture`: those rows are per-instance rather than catalog (the same flatscreen
// appears three times), half are unpriced, and the table is intentionally uncached.
export function gameshowPool(cache = getItemCache()) {
  const seen = new Set();
  const pool = [];
  for (const it of cache.values()) {
    const value = Number(it?.value);
    if (!Number.isFinite(value) || value < PRIZE_MIN_VALUE || value > PRIZE_MAX_VALUE) continue;
    // Street chemistry is both unguessable (median 8cr) and not what a network gives
    // away on daytime television.
    if (it.type === 'drug' || it.type === 'chemical') continue;
    // The description lives on the description TAG; the column is only a fallback for
    // rows that never got one (docs/items.md). Reading the column alone silently drops
    // every tag-only item out of the prize pool.
    const blurb = it.tags?.description ?? it.description ?? '';
    if (!it.name || !String(blurb).trim()) continue;                  // can't be presented on air
    const key = String(it.name).toLowerCase();
    if (seen.has(key)) continue;                                      // never show one prize twice
    seen.add(key);
    pool.push({ id: it.id, name: it.name, value, type: it.type || 'misc' });
  }
  // LOAD-BEARING: the item cache iterates in DB insertion order, which is not guaranteed
  // stable across restarts. Sorting by id before any seeded shuffle is what makes the
  // episode reproducible — without it, two servers (or the same server after a restart)
  // would disagree about tonight's lots.
  pool.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return pool;
}

function tierOf(item) {
  if (item.value <= TIER_CHEAP_MAX) return 'cheap';
  if (item.value <= TIER_MID_MAX) return 'mid';
  return 'dear';
}

// Split the pool into value bands, each independently shuffled by the episode rng.
// Rounds draw from the band that suits them, so the show has a shape: something small
// to warm up, something worth real money to finish on.
function gameshowTiers(pool, rand) {
  const t = { cheap: [], mid: [], dear: [] };
  for (const it of pool) t[tierOf(it)].push(it);
  return { cheap: sportsShuffle(t.cheap, rand), mid: sportsShuffle(t.mid, rand), dear: sportsShuffle(t.dear, rand) };
}

// Deal n lots from a tier, falling back through the other bands when a band is thin, so
// a sparse catalog still produces a full episode rather than a broken one.
function deal(tiers, tier, n) {
  const order = tier === 'dear' ? ['dear', 'mid', 'cheap'] : tier === 'mid' ? ['mid', 'cheap', 'dear'] : ['cheap', 'mid', 'dear'];
  const out = [];
  for (const t of order) {
    while (out.length < n && tiers[t].length) out.push(tiers[t].shift());
    if (out.length >= n) break;
  }
  return out;
}

// A plausible-looking wrong answer: a stranger's guess, deterministic from the episode
// rng, scattered around the true price and rounded the way a person rounds. Wide enough
// that the NPCs lose convincingly without looking scripted.
function npcGuessValue(price, rand) {
  const raw = price * (0.55 + rand() * 0.9);
  const step = price > 2000 ? 100 : price > 400 ? 25 : price > 60 ? 5 : 1;
  return Math.max(1, Math.round(raw / step) * step);
}

// Closest without going over. Over-bidding is elimination, not a penalty.
export function scorePrice(entries, price) {
  let best = null;
  for (const e of entries) {
    const v = Number(e.value);
    if (!Number.isFinite(v) || v > price) continue;
    if (!best || v > Number(best.value)) best = e;
  }
  return best;
}

// Binary. First correct answer takes it.
export function scoreOverUnder(entries, correct) {
  return entries.find(e => e.value === correct) || null;
}

// Order three lots cheapest→priciest. Score = adjacent pairs in the right order, so for
// three items a perfect 2 IS the exact order. Only a UNIQUE top scorer wins — a shared
// best means nobody got it, which happens often enough to be dramatic.
export function scoreLot(entries, correctOrder) {
  const rank = new Map(correctOrder.map((slot, i) => [slot, i]));
  const scored = entries.map(e => {
    const order = Array.isArray(e.value) ? e.value : [];
    let s = 0;
    for (let i = 0; i + 1 < order.length; i++) {
      const a = rank.get(order[i]), b = rank.get(order[i + 1]);
      if (a !== undefined && b !== undefined && a < b) s++;
    }
    return { e, s };
  });
  if (!scored.length) return null;
  const top = Math.max(...scored.map(x => x.s));
  const winners = scored.filter(x => x.s === top);
  return winners.length === 1 ? winners[0].e : null;
}

// The finale: inside a band either side, first one in wins.
export function scoreShowcase(entries, price, band = SHOWCASE_BAND) {
  const lo = price * (1 - band), hi = price * (1 + band);
  return entries.find(e => {
    const v = Number(e.value);
    return Number.isFinite(v) && v >= lo && v <= hi;
  }) || null;
}

// ═════════════════════════════════════════════════════════════════════════════
// BASIN — "what do you actually know about this city?"
//
// One format, `choice`: a question and lettered options, answered `guess b`. Four
// scoring modes were the wrong shape here — a quiz round is right or it isn't, and one
// parse means the finale can be harder (more options) without teaching a second verb.
//
// The material is world content that is ALREADY in memory and already authored: the
// district registry's blurbs, the orders' own creeds, and where the city's NPCs sleep.
// Nothing here is written twice — a district added later becomes a question with no
// authoring, which is the same property that made the retail pool worth building.
// ═════════════════════════════════════════════════════════════════════════════

const CHOICE_LETTERS = ['a', 'b', 'c', 'd'];
// Below this a category can't pose a question — you need the answer plus enough
// distractors to make choosing it mean something.
const MIN_CANDIDATES = 3;

// Trim an authored blurb to something a host can say in one breath.
function speakable(text, max = 220) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).replace(/[\s,;:]+\S*$/, '')}…`;
}

// LOAD-BEARING. The authored copy was written to be read ABOUT a place, not as a riddle,
// so it very often names it: the Pioneers' creed opens "The old world is a corpse and the
// Pioneers refuse to keep it on life support", which quoted verbatim is a question that
// answers itself. Blank the answer's own name out of the quote before it goes on air.
//
// Every significant word of the name is masked independently, not just the whole string —
// "the Commercial Strip" has to catch a later bare "the Strip" too. Short words ("the",
// "of") are skipped: masking those would shred ordinary prose.
function redactAnswer(text, answer) {
  const words = String(answer || '').split(/\s+/).filter(w => w.replace(/\W/g, '').length > 3);
  let out = String(text || '');
  // Longest first, so "Commercial Strip" is masked as one bar rather than two adjacent ones.
  for (const w of [answer, ...words].sort((a, b) => String(b).length - String(a).length)) {
    const esc = String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!esc) continue;
    out = out.replace(new RegExp(`(?:\\bthe\\s+)?\\b${esc}\\b`, 'gi'), '————');
  }
  // Collapse the runs a multi-word mask leaves behind, so a quote reads as one redaction
  // rather than a row of them.
  return out.replace(/(?:————[\s,'’]*)+/g, '———— ').replace(/\s+/g, ' ').trim();
}

// Districts with enough authored copy to be quoted on air. Sorted by id for the same
// reason the retail pool is: the registry's key order is not a stable contract.
function districtPool() {
  return Object.values(DISTRICTS)
    .filter(d => d?.id && d.name && String(d.blurb || '').trim())
    .map(d => ({ id: d.id, name: d.name, blurb: d.blurb }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// The orders, quoted from their own description. `is_npc` keeps player-founded corps out
// — a corp somebody made last Tuesday is not general knowledge.
function orderPool() {
  return [...world.orgs.values()]
    .filter(o => o?.id && o.name && o.is_npc && String(o.description || '').trim())
    .map(o => ({ id: o.id, name: o.name, creed: o.description }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// NPCs whose home zone resolves to a NAMED district. A resident of the fallback district
// is not a question — the answer would be a blank.
function residentPool() {
  const out = [];
  for (const npc of world.npcs.values()) {
    if (!npc?.id || !npc.name || !npc.home_zone) continue;
    const zone = world.zones.get(npc.home_zone);
    if (!zone) continue;
    const d = DISTRICTS[zone.flags?.district] || null;
    if (!d?.name) continue;
    out.push({ id: npc.id, name: npc.name, district: d.name });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

// Assemble one multiple-choice round: take the answer, draw distinct distractors from the
// same pool, shuffle, and letter them. Returns null when the pool can't furnish a full
// set of options — the caller skips the round rather than airing a two-option "quiz".
function buildChoice(rand, { question, answer, distractors, optionCount, subtitle }) {
  const pool = distractors.filter(d => d !== answer);
  if (pool.length + 1 < Math.max(MIN_CANDIDATES, optionCount)) return null;
  const picked = sportsShuffle([...new Set(pool)], rand).slice(0, optionCount - 1);
  if (picked.length < optionCount - 1) return null;
  const options = sportsShuffle([answer, ...picked], rand);
  const correct = CHOICE_LETTERS[options.indexOf(answer)];
  return {
    question,
    subtitle: subtitle || '',
    options,
    correct,
    // The options as the host reads them out, and as the card prints them.
    spoken: options.map((o, i) => `${CHOICE_LETTERS[i].toUpperCase()}, ${o}`).join('. '),
    card: options.map((o, i) => `${CHOICE_LETTERS[i].toUpperCase()} · ${String(o).toUpperCase()}`).join('\n'),
  };
}

// Test seam for regress.js — never used in production paths.
export const _subjectsTest = {
  SUBJECTS, districtPool, orderPool, residentPool, buildChoice, speakable, redactAnswer,
  gameshowTiers, deal, tierOf, npcGuessValue,
  CHOICE_LETTERS, PRIZE_MIN_VALUE, PRIZE_MAX_VALUE, SHOWCASE_BAND, OVERUNDER_MIN_RATIO,
};
