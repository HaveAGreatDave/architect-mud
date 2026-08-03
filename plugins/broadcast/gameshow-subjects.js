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
    if (!it.name || !String(it.description || '').trim()) continue;   // can't be presented on air
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

export const retailSubject = registerGameshowSubject({
  id: 'retail',

  // Formats in fixed order so the episode has a shape: a fast binary warm-up, the
  // canonical pricing round, the hard one, then the money.
  plan: [
    { format: 'overunder', tier: 'mid', count: 2 },
    { format: 'price', tier: 'mid', count: 1 },
    { format: 'lot', tier: 'cheap', count: 3 },
    { format: 'showcase', tier: 'dear', count: 1, showcase: true },
  ],

  episode(rand, ctx) {
    const tiers = gameshowTiers(gameshowPool(ctx.cache), rand);
    const contestantNames = ctx.contestantNames || [];

    return {
      round(spec) {
        let prizes = deal(tiers, spec.tier, spec.count);
        if (prizes.length < spec.count) return null;   // catalog too thin for this format

        // Over-or-under needs two lots that aren't near-neighbours, else the answer is a
        // coin flip. Keep dealing replacements for the second lot until the gap is real.
        if (spec.format === 'overunder') {
          let guard = 0;
          while (guard++ < 12 && Math.max(prizes[0].value, prizes[1].value) / Math.min(prizes[0].value, prizes[1].value) < OVERUNDER_MIN_RATIO) {
            const [next] = deal(tiers, spec.tier, 1);
            if (!next) break;
            prizes = [prizes[0], next];
          }
          if (Math.max(prizes[0].value, prizes[1].value) / Math.min(prizes[0].value, prizes[1].value) < OVERUNDER_MIN_RATIO) return null;
        }

        // Ordering three lots is only answerable if their prices are DISTINCT — two items at
        // the same value make the correct order ambiguous and the round unwinnable. Keep
        // swapping out duplicates until all three differ.
        if (spec.format === 'lot') {
          let guard = 0;
          while (guard++ < 20 && new Set(prizes.map(p => p.value)).size < prizes.length) {
            const dupAt = prizes.findIndex((p, i) => prizes.findIndex(q => q.value === p.value) !== i);
            const [next] = deal(tiers, spec.tier, 1);
            if (!next) break;
            prizes = prizes.map((p, i) => (i === dupAt ? next : p));
          }
          if (new Set(prizes.map(p => p.value)).size < prizes.length) return null;   // couldn't separate them
        }

        const isShowcase = !!spec.showcase;
        const price = prizes[0].value;
        // Lots read cheapest-first, for the ordering round's reveal.
        const ranked = prizes.map((p, i) => ({ slot: i + 1, ...p })).sort((a, b) => a.value - b.value);

        const tok = {
          prize: prizes[0].name,
          prize2: prizes[1]?.name || '',
          prize3: prizes[2]?.name || '',
          price: money(price),
          price2: prizes[1] ? money(prizes[1].value) : '',
          price3: prizes[2] ? money(prizes[2].value) : '',
          // Every lot with its price, in the order they were shown — for a multi-item reveal.
          // The two-lot case (higher-or-lower) gets "against" rather than a comma: this token
          // is read out right after {guesses}, which is itself a comma list of names, and two
          // comma lists in a row parse as one run-on roster.
          prices: prizes.length === 2
            ? `${prizes[0].name} at ${money(prizes[0].value)} against ${prizes[1].name} at ${money(prizes[1].value)}`
            : prizes.map(p => `${p.name} at ${money(p.value)}`).join(', '),
          // The right answer, read out as prose.
          order: ranked.map(p => `${p.name} at ${money(p.value)}`).join(', then '),
          total: money(prizes.reduce((s, p) => s + p.value, 0)),
        };

        // What the strangers said. Baked now so the reveal is deterministic and identical
        // on every set, whether or not a player ever turns up.
        const npcGuesses = contestantNames.slice(0, 3).map((name) => {
          if (spec.format === 'overunder') {
            const pick = rand() < 0.5 ? 'higher' : 'lower';
            return { name, value: pick, label: pick };
          }
          if (spec.format === 'lot') {
            const order = sportsShuffle([1, 2, 3], rand);
            return { name, value: order, label: order.join('-') };
          }
          const v = npcGuessValue(price, rand);
          return { name, value: v, label: money(v) };
        });

        const correct = spec.format === 'overunder'
          ? (prizes[1].value > prizes[0].value ? 'higher' : 'lower')
          : spec.format === 'lot'
            ? prizes.map((p, i) => ({ i: i + 1, v: p.value })).sort((a, b) => a.v - b.v).map(x => x.i)
            : null;

        // The price card. A multi-lot round shows every lot's price, or the card contradicts
        // the line that just aired. The ORDERING round lists them cheapest-first, because that
        // ordering is the answer; every other round lists them as they were shown, so the card
        // matches the order the host read them out in.
        const cardOrder = spec.format === 'lot' ? ranked : prizes;
        const cardText = prizes.length > 1
          ? `ACTUAL RETAIL PRICES\n\n${cardOrder.map(p => `${String(p.name).toUpperCase()} · ${money(p.value)}₵`).join('\n')}`
          : `${String(prizes[0].name).toUpperCase()}\n\nACTUAL RETAIL PRICE · ${money(price)}₵`;

        return {
          tok,
          cardText,
          isShowcase,
          grantsItem: isShowcase,
          node: { prizes: prizes.map(p => ({ id: p.id, name: p.name, value: p.value })), price, correct, npcGuesses },
          keys: { intro: isShowcase ? 'showcase_intro' : `round_intro.${spec.format}`, reveal: isShowcase ? 'showcase_reveal' : 'reveal' },
        };
      },
    };
  },

  score(format, entries, round) {
    switch (format) {
      case 'overunder': return scoreOverUnder(entries, round.correct);
      case 'lot':       return scoreLot(entries, round.correct);
      case 'showcase':  return scoreShowcase(entries, round.price);
      default:          return scorePrice(entries, round.price);
    }
  },

  parse(format, args) {
    const text = String(Array.isArray(args) ? args.join(' ') : (args || '')).trim();
    if (!text) return null;

    if (format === 'overunder') {
      const w = text.toLowerCase().replace(/[^a-z]/g, '');
      if (['higher', 'high', 'over', 'up', 'h'].includes(w)) return { value: 'higher', label: 'higher', spoken: 'Higher.' };
      if (['lower', 'low', 'under', 'down', 'l'].includes(w)) return { value: 'lower', label: 'lower', spoken: 'Lower.' };
      return null;
    }

    if (format === 'lot') {
      const nums = text.match(/[1-3]/g);
      if (!nums || nums.length !== 3) return null;
      const order = nums.map(Number);
      if (new Set(order).size !== 3) return null;
      return { value: order, label: order.join('-'), spoken: `${order.join(', then ')}.` };
    }

    // price / showcase — a plain number, commas and a leading ₵ tolerated.
    const m = text.replace(/[,₵]/g, '').match(/\d+/);
    if (!m) return null;
    const v = Number(m[0]);
    if (!Number.isFinite(v) || v <= 0) return null;
    return { value: v, label: money(v), spoken: `${money(v)} credits.` };
  },

  hint(format) {
    if (format === 'overunder') return 'Say `guess higher` or `guess lower`.';
    if (format === 'lot') return 'Order all three — `guess 2 1 3` — cheapest first.';
    return 'Name a price in credits — `guess 400`.';
  },
});

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

// The categories, in the order the plan draws them. Each returns a buildChoice payload or
// null. A category that can't answer today is skipped and the next one tried, so a thin
// world degrades to a shorter show rather than a broken one.
const BASIN_CATEGORIES = {
  district(rand, state) {
    const pool = state.districts;
    const d = pool[state.districtIdx++ % pool.length];
    if (!d) return null;
    return buildChoice(rand, {
      question: `Which part of town is this? "${redactAnswer(speakable(d.blurb), d.name)}"`,
      subtitle: 'THE BASIN',
      answer: d.name,
      distractors: pool.map(x => x.name),
      optionCount: state.optionCount,
    });
  },
  order(rand, state) {
    const pool = state.orders;
    const o = pool[state.orderIdx++ % pool.length];
    if (!o) return null;
    return buildChoice(rand, {
      question: `Whose creed is this? "${redactAnswer(speakable(o.creed), o.name)}"`,
      subtitle: 'THE ORDERS',
      answer: o.name,
      distractors: pool.map(x => x.name),
      optionCount: state.optionCount,
    });
  },
  resident(rand, state) {
    const pool = state.residents;
    const r = pool[state.residentIdx++ % pool.length];
    if (!r) return null;
    return buildChoice(rand, {
      question: `Where does ${r.name} go home to at night?`,
      subtitle: 'WHO LIVES WHERE',
      answer: r.district,
      distractors: state.districts.map(x => x.name),
      optionCount: state.optionCount,
    });
  },
};

export const basinSubject = registerGameshowSubject({
  id: 'basin',

  // Rising difficulty by widening the field, not by getting obscurer: three options to
  // warm up, then four, and the finale is four on the category with the most material.
  plan: [
    { format: 'choice', category: 'district', optionCount: 3 },
    { format: 'choice', category: 'order',    optionCount: 3 },
    { format: 'choice', category: 'resident', optionCount: 4 },
    { format: 'choice', category: 'district', optionCount: 4, showcase: true },
  ],

  episode(rand, ctx) {
    const contestantNames = ctx.contestantNames || [];
    // Shuffled once per episode and then walked with an index, so a four-round show never
    // asks the same district twice — the retail pool gets this from `deal` shifting a
    // shuffled array; this is the same guarantee for a pool that isn't consumed.
    const state = {
      districts: sportsShuffle(districtPool(), rand),
      orders: sportsShuffle(orderPool(), rand),
      residents: sportsShuffle(residentPool(), rand),
      districtIdx: 0, orderIdx: 0, residentIdx: 0,
      optionCount: 3,
    };

    return {
      round(spec) {
        state.optionCount = Math.min(CHOICE_LETTERS.length, Math.max(3, Number(spec.optionCount) || 3));
        // Try the named category, then any other — a world with no orgs loaded still gets
        // a show out of its districts.
        const order = [spec.category, ...Object.keys(BASIN_CATEGORIES).filter(k => k !== spec.category)];
        let q = null;
        for (const cat of order) {
          q = BASIN_CATEGORIES[cat]?.(rand, state) || null;
          if (q) break;
        }
        if (!q) return null;

        const isShowcase = !!spec.showcase;

        // The strangers answer at random — a letter each, deterministic from the episode
        // rng. They are wrong about as often as three people picking blind, which is the
        // honest rate and leaves the round genuinely winnable by whoever is in the studio.
        const npcGuesses = contestantNames.slice(0, 3).map((name) => {
          const letter = CHOICE_LETTERS[Math.floor(rand() * q.options.length)];
          return { name, value: letter, label: letter.toUpperCase() };
        });

        const answerText = q.options[CHOICE_LETTERS.indexOf(q.correct)];
        const tok = {
          question: q.question,
          options: q.spoken,
          answer: `${q.correct.toUpperCase()}, ${answerText}`,
          answer_letter: q.correct.toUpperCase(),
          answer_text: answerText,
          // `prize` is read by the shared prize_copy/verdict pools, so a subject that has
          // no lot still has something for the announcer to point at.
          prize: q.subtitle || 'tonight’s question',
        };

        return {
          tok,
          cardText: `${q.subtitle || 'THE ANSWER'}\n\n${q.card}\n\nCORRECT · ${q.correct.toUpperCase()}`,
          isShowcase,
          // Nothing is handed over but money: a quiz has no lot to give away, and granting
          // a random item as a consolation would put untraceable loot on the floor.
          grantsItem: false,
          node: { prizes: [], price: 0, correct: q.correct, npcGuesses, question: q.question, options: q.options },
          keys: { intro: isShowcase ? 'showcase_intro' : 'round_intro.choice', reveal: isShowcase ? 'showcase_reveal' : 'reveal' },
        };
      },
    };
  },

  // Right or wrong, first one in wins. Ties go to whoever answered first, same as retail.
  score(format, entries, round) {
    return entries.find(e => String(e.value) === String(round.correct)) || null;
  },

  parse(format, args) {
    const text = String(Array.isArray(args) ? args.join(' ') : (args || '')).trim().toLowerCase();
    if (!text) return null;
    // First letter only, so "b", "B.", "answer b" and "b, the ashway" all land the same.
    const m = text.match(/\b([a-d])\b/);
    if (!m) return null;
    const letter = m[1];
    return { value: letter, label: letter.toUpperCase(), spoken: `${letter.toUpperCase()}.` };
  },

  hint() { return 'Answer with a letter — `guess b`.'; },
});

// Test seam for regress.js — never used in production paths.
export const _subjectsTest = {
  SUBJECTS, districtPool, orderPool, residentPool, buildChoice, speakable, redactAnswer,
  gameshowTiers, deal, tierOf, npcGuessValue,
  CHOICE_LETTERS, PRIZE_MIN_VALUE, PRIZE_MAX_VALUE, SHOWCASE_BAND, OVERUNDER_MIN_RATIO,
};
