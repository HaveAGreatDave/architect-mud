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

export const BUDGET = { handle: 16, epithet: 28, lastSeen: 340, origin: 150, quote: 90, zone: 24 };

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

export function weightedPick(pairs, rand = Math.random) {
  const total = pairs.reduce((a, p) => a + p[1], 0);
  if (total <= 0) return pairs.length ? pairs[0][0] : null;
  let r = rand() * total;
  for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
  return pairs[pairs.length - 1][0];
}

// minRank 1 on the last card is the "no all-common sleeve" guarantee; the
// remaining weights renormalise themselves through weightedPick.
export function rollRank(minRank = 0, rand = Math.random) {
  return weightedPick(RANKS.map((r, i) => [r, i < minRank ? 0 : RANK_WEIGHT[r]]), rand);
}

export function rollSleeve(rand = Math.random) {
  const size = weightedPick(SLEEVE_SIZES, rand);
  const ranks = [];
  for (let i = 0; i < size - 1; i++) ranks.push(rollRank(0, rand));
  ranks.push(rollRank(1, rand));                       // the hit
  ranks.sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b));   // reveal ascending
  return ranks;
}
