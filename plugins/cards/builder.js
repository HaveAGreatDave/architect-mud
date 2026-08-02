// CARD BUILDER — turns a player, an NPC or an enemy into the five text regions a
// card prints, under HARD character budgets.
//
// THE LOAD-BEARING RULE: we never truncate. Clauses are emitted in priority order
// and the first one that would cross the budget ends the region — every clause
// after it is skipped too, because skipping AROUND a clause reorders the sentence
// and reads worse than stopping. An omitted clause is invisible; a truncated one
// is a bug the player can see.
//
// Same instinct as firstSentence() in server/engine/commands/describe.js: take
// whole units or none.
import { getItem } from '../../server/engine/items-cache.js';

export const BUDGET = { handle: 16, epithet: 28, lastSeen: 340, origin: 150, quote: 90, zone: 24, marks: 74 };

// ── field marks ────────────────────────────────────────────────────────────────
// The physical line a real trading card carries — HT/WT/BATS/THROWS, except this
// is a city full of people nobody recorded a height for. There are no physical
// columns on `npcs` or `enemies`, so the obvious move would be to invent some
// from the id. THAT IS THE TRAP: an authored description reading "a vast slab of
// a man" next to a rolled 5'4" is a card that argues with itself, and the player
// believes the sentence, not the stat.
//
// So marks are LIFTED, never invented — we read the author's own description and
// print back the physical vocabulary that is already in it. A card can therefore
// never contradict its subject, an unauthored NPC simply gets no marks line (and
// per the ladder rule, an omitted region is invisible), and any writer who adds
// "one milky eye" to a description gets it on the card for free.
//
// Order is presentation order, so a card reads build → colouring → face → wear →
// augments → gait rather than in whatever sequence the prose happened to use.
const MARKS = [
  // build
  [/\b(towering|giant|huge|enormous|massive|hulking)\b/i, 'built like a door'],
  [/\b(tall|lanky|rangy|long-limbed)\b/i, 'tall'],
  [/\b(short|squat|stocky|compact)\b/i, 'low and square'],
  [/\b(thin|skinny|gaunt|scrawny|bony|emaciated|wiry|spare)\b/i, 'thin as a rumour'],
  [/\b(fat|heavy|broad|barrel-chested|thickset|thick-set|bulky)\b/i, 'heavy through the shoulders'],
  [/\b(muscl|brawn|powerful|slabs of)\w*/i, 'muscle you can see through the coat'],
  // colouring + hair
  [/\b(bald|shaven|shaved head)\b/i, 'bald'],
  [/\bhairless\b/i, 'hairless'],
  [/\b(grey|gray|silver|white)[- ]hair\w*|\bhair (?:is |gone )?(?:grey|gray|white|silver)\b/i, 'grey at the temples'],
  [/\b(red|ginger|auburn)[- ]hair\w*/i, 'red-haired'],
  [/\b(dread|braid|topknot|mohawk|shock of hair|ponytail)\w*/i, 'hair you notice first'],
  [/\b(beard|stubble|moustache|mustache|whisker)\w*/i, 'unshaven'],
  // face
  [/\b(scar|scarred|scarring)\w*/i, 'scarred'],
  [/\b(burn|burnt|burned|scald)\w*\b/i, 'burn-marked'],
  [/\b(milky|blind|clouded) eye\b|\beye ?patch\b|\bone eye\b/i, 'one eye gone'],
  [/\b(tattoo|inked|ink across|brand)\w*/i, 'inked'],
  // NOT /pierc\w*/ — "a piercing shriek" and "piercing eyes" are everywhere in
  // the roster, and a false mark is worse than a missing one: a card that says
  // something untrue about its subject is the failure this whole table avoids.
  [/\b(pierced|ear ?ring|nose ring|septum|stud through|ring through)\w*/i, 'pierced'],
  [/\b(pock|pox|rash|sore|lesion|boil)\w*/i, 'bad skin'],
  [/\b(rot|rotting|putrid|decay|maggot|carrion)\w*/i, 'rotting'],
  // augments
  [/\b(chrome|augment|implant|prosthe|cyber|bionic|servo|steel arm|metal jaw)\w*/i, 'chromed'],
  [/\b(mutat|tumour|tumor|growth|extra (?:arm|finger|eye)|second head)\w*/i, 'mutated'],
  // gait + voice
  [/\b(limp|limping|hobbl|crutch|cane|prosthetic leg)\w*/i, 'walks with a limp'],
  [/\b(stoop|hunch|bent)\w*/i, 'stooped'],
  [/\b(rasp|hoarse|gravel|wheez|cough)\w*/i, 'sounds like a bad engine'],
  // Wear comes LAST on purpose. It is the most common vocabulary in the whole
  // roster — half of Coldwater is described as filthy — so if it ranked early it
  // would win the four-mark budget on every card and crowd out the chrome arm
  // and the limp, which are the marks that actually tell two people apart.
  // Every mark here is also gender-neutral: the table can't see who it's about.
  [/\b(filthy|grimy|greasy|stained|soot|reek|stink)\w*/i, 'wears the week'],
  [/\b(immaculate|pressed|spotless|tailored|crisp)\b/i, 'immaculate'],
];

// Pull the marks a description already contains, in table order. `extra` is for
// marks that come from somewhere other than prose (an enemy's own combat numbers),
// and leads, because a rot-hound is its numbers first and its adjectives second.
export function fieldMarks(text, extra = []) {
  const src = String(text || '');
  const out = [...extra];
  for (const [re, mark] of MARKS) {
    if (out.length >= 4) break;       // four is a line; five is a paragraph
    if (re.test(src) && !out.includes(mark)) out.push(mark);
  }
  // Budgeted like every other region: whole marks or none, never a cut one.
  const joined = [];
  let len = 0;
  for (const m of out) {
    const cost = len ? m.length + 3 : m.length;
    if (len + cost > BUDGET.marks) break;
    joined.push(m); len += cost;
  }
  return joined.join(' · ');
}

// An enemy's physique IS its stat line — a thing with 80 HP and no dodge is a
// different animal from one with 12 HP that you can't hit, and the card should
// say so in words before it prints the numbers underneath.
export function combatMarks(enemy, maxDmg) {
  const out = [];
  const hp = Number(enemy.hp_max) || 0;
  const dodge = Number(enemy.dodge) || 0;
  const hit = Number(enemy.hit) || 0;
  if (hp >= 60) out.push('takes a beating');
  else if (hp <= 14) out.push('goes down easy');
  if (dodge >= 5) out.push('hard to lay hands on');
  else if (dodge <= 1) out.push('slow, and knows it');
  if (maxDmg >= 12) out.push('hits like a dropped engine');
  else if (maxDmg <= 3 && hit <= 2) out.push('more noise than damage');
  return out.slice(0, 2);
}

export const RANKS = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
// pool weights, and the one rank that can never be rolled
export const RANK_WEIGHT = { common: 58, uncommon: 25, rare: 12, epic: 4, legendary: 1, architect: 0 };

// ── budget helpers ─────────────────────────────────────────────────────────────

// Emit ranked clauses until one would cross the budget, then stop. `required` is
// the count of leading clauses that must all fit or the whole thing is unbuildable.
export function ladder(clauses, budget, required = 0) {
  const out = [];
  let len = 0;
  for (let i = 0; i < clauses.length; i++) {
    const c = String(clauses[i] || '').trim();
    if (!c) continue;
    const cost = len ? c.length + 1 : c.length;
    if (len + cost > budget) {
      if (i < required) return null;   // a mandatory clause didn't fit
      break;
    }
    out.push(c);
    len += cost;
  }
  if (out.length < required) return null;
  return out.join(' ');
}

// Whole sentences from the start, never a partial one. Mirrors the sentence regex
// describe.js uses for light-truncation.
export function wholeSentences(text, budget) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (t.length <= budget) return t;
  const sentences = t.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!sentences) return '';           // one long fragment: it fits or it doesn't
  let out = '';
  for (const s of sentences) {
    const next = out ? `${out} ${s.trim()}` : s.trim();
    if (next.length > budget) break;
    out = next;
  }
  return out;
}

// A quote is never edited to fit. Walk candidates newest-first and take the first
// one that qualifies; if none do, the region prints its silence copy.
export const SILENCE = '— said nothing worth printing —';
export function pickQuote(candidates, budget = BUDGET.quote) {
  for (const raw of candidates || []) {
    let q = String(raw || '').trim().replace(/\s+/g, ' ');
    // NPC chitchat is third-person ACTION text ("drags his rebar along the
    // ground") with any actual speech wrapped in quotes inside it. Overheard is a
    // spoken line, so pull the speech out when there is some — and skip the line
    // entirely when there isn't, rather than printing stage direction as dialogue.
    const spoken = q.match(/["“]([^"”]{2,})["”]/);
    if (spoken) q = spoken[1].trim();
    else if (/^[a-z]/.test(q)) continue;
    if (!q || q.length > budget) continue;
    if (/^[./@;]/.test(q)) continue;   // looks like a command, not speech
    // Combat cries and dialogue lines carry substitution tokens ($enemy, $player,
    // {name}). A card is printed once and never re-rendered against a scene, so a
    // token would sit there forever as literal text. Skip, don't substitute.
    if (/[${]/.test(q)) continue;
    return q;
  }
  return SILENCE;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Authored prose often wraps its speech in quotes; the card supplies its own, so
// a stored block must not carry a second pair (“"Clean it, check it."”).
export function stripWrappingQuotes(s) {
  const t = String(s || '').trim();
  return /^["“].*["”]$/.test(t) ? t.slice(1, -1).trim() : t;
}

// Faction and behaviour fields are slugs (`ideology_long_watch`). The epithet is
// read by a human on a printed object, so it gets read like one.
export function prettyTag(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  return t.replace(/^(ideology|org|faction)_/, '').replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase()).slice(0, BUDGET.epithet);
}
const article = n => (/^[aeiou]/i.test(n) ? 'an' : 'a') + ' ' + n;

// ── condition, spoken rather than labelled ─────────────────────────────────────
// The band name belongs on the back of the card. On the front a coat is "gone thin
// at the shoulders". Bands mirror docs/systems-durability.md.
export function conditionBand(c) {
  const v = Number(c);
  if (!Number.isFinite(v)) return 'sound';
  if (v >= 0.85) return 'pristine';
  if (v >= 0.6) return 'sound';
  if (v >= 0.35) return 'serviceable';
  if (v >= 0.15) return 'battered';
  return 'failing';
}
const DAMAGE = {
  battered: { torso: 'gone thin at the shoulders', hands: 'worn through at the palm', feet: 'split along the welt', head: 'scored and scuffed', legs: 'frayed at the cuff' },
  failing:  { torso: 'coming apart at the seam', hands: 'split at the knuckles', feet: 'held together with wire', head: 'cracked across the visor', legs: 'more patch than trouser' },
};
function damageFor(slot, band) {
  return DAMAGE[band]?.[slot] || (band === 'failing' ? 'barely holding' : band === 'battered' ? 'badly worn' : '');
}

// ── tier, borrowed from the portrait renderer's own roll ───────────────────────
export function tierIndex(value = 0, armor = 0) {
  const v = Number(value) || 0, a = Number(armor) || 0;
  let t = v >= 8000 ? 4 : v >= 3000 ? 3 : v >= 900 ? 2 : v >= 200 ? 1 : 0;
  if (a >= 3) t = Math.max(t, 2);
  if (a >= 6) t = Math.max(t, 3);
  return Math.min(4, t);
}

// ── PLAYER ─────────────────────────────────────────────────────────────────────
// equipped: [{ item_id, layer, condition }]; physLine: physicalDescription() output.
export function buildPlayerCard({ player, equipped = [], physLine = '', quotes = [] }) {
  const bySlot = {};
  for (const row of equipped) {
    const it = getItem(row.item_id);
    if (!it) continue;
    const slot = it.tags?.slot;
    if (!slot) continue;
    const layer = row.layer ?? 0;
    const entry = { item: it, layer, band: conditionBand(row.condition), tier: tierIndex(it.value, it.tags?.armor) };
    if (slot === 'accessory') (bySlot.accessory ||= []).push(entry);
    else if (!bySlot[slot] || layer > bySlot[slot].layer) {
      if (bySlot[slot]) (bySlot._under ||= []).push(bySlot[slot]);
      bySlot[slot] = entry;
    } else (bySlot._under ||= []).push(entry);
  }

  const worn = (slot) => {
    const e = bySlot[slot];
    if (!e) return '';
    const dmg = damageFor(slot, e.band);
    return article(e.item.name) + (dmg ? `, ${dmg}` : '');
  };

  const body = physLine ? physLine.replace(/\.$/, '') : `${player.handle}, as they were`;
  const upper = [worn('head'), worn('torso')].filter(Boolean);
  const lower = [worn('legs'), worn('feet')].filter(Boolean);
  const weapon = bySlot.weapon_hand;
  const under = (bySlot._under || []).map(e => e.item.name);
  const acc = (bySlot.accessory || []).map(e => e.item.name);

  const clauses = [
    body + '.',
    upper.length ? `They wore ${upper.join(' and ')}.` : '',
    lower.length ? `${cap(lower.join(', '))}.` : '',
    weapon ? `They carried ${article(weapon.item.name)}.` : '',
    under.length ? `Underneath, ${under.join(' and ')}.` : '',
    acc.length ? `${cap(acc.join(', '))} on them.` : '',
  ];
  // rank 0 (body) is mandatory; rank 1 (what they wore) is mandatory when they
  // were wearing anything at all.
  const required = upper.length ? 2 : 1;
  let lastSeen = ladder(clauses, BUDGET.lastSeen, required);
  if (!lastSeen && !upper.length && !lower.length && !weapon) lastSeen = 'Nothing on. Nothing to report.';
  if (!lastSeen) lastSeen = ladder([clauses[0], clauses[1]], BUDGET.lastSeen, 1);

  const items = Object.values(bySlot).flat().filter(e => e && e.item);
  const power = items.reduce((a, e) => a + Math.round((Number(e.item.value) || 0) / 100) + (Number(e.item.tags?.armor) || 0) * 6, 0);
  const rarity = RANKS[items.length ? Math.max(...items.map(e => e.tier)) : 0];

  return {
    subject_type: 'player',
    subject_ref: String(player.id),
    subject_name: player.handle,
    body: player.biological_sex === 'female' ? 'female' : 'male',
    rarity, power,
    spec: {
      item_ids: items.map(e => e.item.id),
      conditions: items.map(e => e.band),
      manifest: items.map(e => ({ name: e.item.name, band: e.band, tier: e.tier })),
      stats: {
        brawn: player.stat_brawn, reflexes: player.stat_reflexes, endurance: player.stat_endurance,
        brains: player.stat_brains, cool: player.stat_cool, senses: player.stat_senses,
      },
    },
    text_blocks: {
      epithet: prettyTag(player.archetype) || 'Unaffiliated',
      // A player's marks come off their own physical description, so the line is
      // built the same way for all three subject types even though only players
      // have a real body behind it.
      marks: fieldMarks(physLine),
      last_seen: lastSeen,
      origin: wholeSentences(player.origin_fragment, BUDGET.origin),
      quote: pickQuote(quotes),
    },
  };
}

// ── NPC ────────────────────────────────────────────────────────────────────────
// Auto-derived: every NPC is a card without anybody authoring one. flags.card_*
// are the optional overrides for the ones that deserve better.
export function buildNpcCard(npc) {
  const f = npc.flags || {};
  const layers = Array.isArray(f.clothing_layers) ? f.clothing_layers.filter(Boolean) : [];
  const clauses = [
    String(npc.description || '').trim(),
    layers.length ? `They wore ${layers[0]}${layers.length > 1 ? `, over ${layers.slice(1).join(' and ')}` : ''}.` : '',
  ];
  // The origin block and the quote must not be the same sentence twice. Whatever
  // the origin consumed is dropped from the quote candidates.
  const chitchat = Array.isArray(npc.chitchat) ? npc.chitchat : [];
  const originSrc = f.card_note || chitchat[0] || '';
  const origin = wholeSentences(stripWrappingQuotes(originSrc), BUDGET.origin);
  const quotes = [f.card_quote, ...firstBanterTurns(npc.banter), ...chitchat]
    .filter(q => q && String(q) !== String(originSrc));

  return {
    subject_type: 'npc',
    subject_ref: String(npc.id),
    subject_name: npc.name,
    body: npc.sex === 'female' ? 'female' : 'male',
    rarity: RANKS.includes(f.card_rarity) ? f.card_rarity : npcRarity(npc),
    power: Number(f.card_standing) || 20,
    spec: { faction: npc.faction || null, home: npc.home_zone || null, layers },
    text_blocks: {
      epithet: prettyTag(npc.faction) || 'unaligned',
      // Lifted from the author's own description, plus what they're wearing —
      // the one physical fact about an NPC that is recorded rather than prose.
      marks: fieldMarks(`${npc.description || ''} ${layers.join(' ')}`),
      last_seen: ladder(clauses, BUDGET.lastSeen, 1) || '',
      origin,
      quote: pickQuote(quotes),
    },
  };
}
// Rank by ROLE, derived so an unauthored roster still produces a spread — a world
// where every NPC is Common gives the rare pack slots nothing to draw but
// monsters. `flags.card_rarity` overrides this whenever somebody cares enough.
// The signal is how much authoring an NPC already carries: a written dialogue
// tree or a behaviour graph is somebody having decided this person matters.
export function npcRarity(npc) {
  const f = npc.flags || {};
  const vendor = (Array.isArray(npc.vendor_inventory) && npc.vendor_inventory.length) || !!npc.vendor_shop_name;
  // NOT dialogue_tree or behaviour_graph: 177 of 178 NPCs have one, so as a
  // signal of "somebody cared about this person" it's worthless. Running a shop
  // is the honest tell — it means a name, a stock list and a place.
  if (f.faction_head || f.quest_giver) return 'epic';
  if (vendor && npc.faction) return 'rare';
  if (vendor) return 'uncommon';
  // Everything else stays Common ON PURPOSE. Commons are pulled 58% of the time,
  // so a thin common tier means the same few faces every sleeve — the bulk of the
  // roster has to live down here for duplicates to feel like bad luck rather than
  // the only possible outcome.
  return 'common';
}

function firstBanterTurns(banter) {
  if (!Array.isArray(banter)) return [];
  const out = [];
  for (const thread of banter) if (Array.isArray(thread)) out.push(...thread.filter(t => typeof t === 'string'));
  return out;
}

// ── ENEMY ──────────────────────────────────────────────────────────────────────
// A different object on purpose: no .describe, because a rot-hound has never
// written anything about itself. It gets a field-guide register instead.
export function buildEnemyCard(enemy, spawn = {}) {
  const f = enemy.flags || {};
  const dmg = Array.isArray(enemy.weapon) ? enemy.weapon : [];
  const maxDmg = dmg.reduce((a, d) => a + (Number(d?.max) || 0), 0) || 3;
  const power = Math.round((Number(enemy.hp_max) || 20) / 2 + (Number(enemy.hit) || 1) * 3 + maxDmg * 2);

  return {
    subject_type: 'enemy',
    subject_ref: String(enemy.id),
    subject_name: enemy.name,
    body: null,                       // no silhouette for a rot-hound: text face only
    rarity: enemyRarity(spawn),
    power,
    spec: {
      hp_max: enemy.hp_max, hit: enemy.hit, dodge: enemy.dodge, weapon: dmg,
      butcher: enemy.butcher_difficulty ?? null,
      spawn_weight: spawn.spawn_weight ?? null, max_count: spawn.max_count ?? null,
    },
    text_blocks: {
      epithet: prettyTag(enemy.faction || enemy.behavior) || 'Feral',
      // Its numbers lead, then whatever the description physically says about it.
      marks: fieldMarks(enemy.description, combatMarks(enemy, maxDmg)),
      last_seen: ladder([String(enemy.description || '').trim()], BUDGET.lastSeen, 1) || '',
      origin: wholeSentences(stripWrappingQuotes(enemy.death_message), BUDGET.origin),
      quote: pickQuote(Array.isArray(f.battle_cries) ? f.battle_cries : []),
    },
  };
}

// Spawn scarcity is the ONLY rarity signal the codebase has — there is no boss,
// elite, tier or level flag anywhere — so rank falls out of existing content with
// no authoring pass. The thing you rarely meet is the thing worth pulling.
export function enemyRarity({ spawn_weight, max_count, zones } = {}) {
  const w = Number(spawn_weight);
  const n = Number(max_count);
  const z = Number(zones) || 1;
  if (z <= 1 && n === 1) return 'legendary';
  if (!Number.isFinite(w)) return 'common';
  if (w <= 15 || (z <= 1 && n <= 2)) return 'epic';
  if (w <= 40) return 'rare';
  if (w <= 75) return 'uncommon';
  return 'common';
}

// ── pack maths ─────────────────────────────────────────────────────────────────
export const SLEEVE_SIZES = [[4, 22], [5, 48], [6, 22], [7, 7], [9, 1]];

// Mulberry32. Every roller below already took a `rand` function, which is the
// whole reason a seeded sleeve costs nothing to add: hand this in instead of
// Math.random and the SAME sleeve comes out every time for a given seed. That is
// what lets a sleeve's quality be fixed by the coil it came off while being
// stored as one integer rather than a list of cards.
export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weightedPick(pairs, rand = Math.random) {
  const total = pairs.reduce((a, p) => a + p[1], 0);
  if (total <= 0) return pairs.length ? pairs[0][0] : null;
  let r = rand() * total;
  for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
  return pairs[pairs.length - 1][0];
}

// ── the hot sleeve ─────────────────────────────────────────────────────────────
// Occasionally a sleeve comes off the line with a fat print run in it: TRIPLE
// weight on epic and legendary, everything else untouched. Per card that moves
// epic from 4% to ~11% and legendary from 1% to ~2.7% once the total renormalises.
//
// It is DELIBERATELY invisible until the tear. A hot sleeve you could spot behind
// the glass would just be the sleeve everybody buys, and the coil choice would
// collapse into "take the gold one" — so the thing that makes a pick feel lucky
// has to be something you find out you were right about, not something you read.
// The reveal is where it announces itself, which is also where it is worth most.
//
// Derived from the sleeve's own seed on a SEPARATE stream (the golden-ratio
// constant), so asking whether a sleeve is hot never perturbs the sleeve it rolls.
export const HOT_RANK_WEIGHT = { ...RANK_WEIGHT, epic: RANK_WEIGHT.epic * 3, legendary: RANK_WEIGHT.legendary * 3 };
export const HOT_CHANCE = 0.08;
export function isHotSeed(seed) {
  return mulberry32(((seed >>> 0) ^ 0x9e3779b9) >>> 0)() < HOT_CHANCE;
}

// minRank 1 on the last card is the "no all-common sleeve" guarantee; the
// remaining weights renormalise themselves through weightedPick.
export function rollRank(minRank = 0, rand = Math.random, weights = RANK_WEIGHT) {
  return weightedPick(RANKS.map((r, i) => [r, i < minRank ? 0 : weights[r]]), rand);
}

export function rollSleeve(rand = Math.random, weights = RANK_WEIGHT) {
  const size = weightedPick(SLEEVE_SIZES, rand);
  const ranks = [];
  for (let i = 0; i < size - 1; i++) ranks.push(rollRank(0, rand, weights));
  ranks.push(rollRank(1, rand, weights));              // the hit
  ranks.sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b));   // reveal ascending
  return ranks;
}
