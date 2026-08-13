/**
 * Relations — what an NPC remembers about you.
 *
 * The engine already tracked how the *world* feels about you (ideology rep,
 * wanted level, corp standing) and how one *vendor* feels about you (the
 * bespoke `trust_flag` in vendor.js, the grudge list in vendor-grudge.js). It
 * never tracked how a PERSON feels about you, which is why the hundredth
 * conversation with a bartender reads exactly like the first.
 *
 * This is the substrate for that, and nothing more. It holds two numbers per
 * (player, NPC) and answers one question — `relationTier` — that dialogue,
 * banter, vendors and descriptions can all read without knowing about each
 * other. It contains no fiction: every line a player ever sees because of this
 * file is authored content, gated on a tier.
 *
 * ── READ TIER (the load-bearing design constraint) ───────────────────────────
 *
 * Rows exist only for NPCs a player has actually MET, so the set is bounded by
 * who you've talked to (tens), not by the 167-NPC roster. That bound is what
 * makes the whole set safe to hold in memory:
 *
 *   login    → ONE indexed query, hydrated into `player._relations` (a Map)
 *   runtime  → every read is a Map lookup. Zero queries. Ever.
 *   writes   → marked dirty in memory, coalesced into one multi-row upsert on a
 *              cadence (the flushDirtyResources pattern) + a final flush at logout
 *
 * This is what lets a relationship be read on paths a query could never live on
 * (room arrival, banter selection, examine text) without touching movement cost.
 * `getRelation` is therefore SYNCHRONOUS BY CONTRACT — it must never learn to
 * await, or every caller inherits a round trip on a hot path.
 *
 * The cache is safe because the write funnel is: this file is the only writer of
 * `player_npc_relations`, by construction (grep it). If a future system starts
 * writing that table directly, this cache goes silently stale — the same reason
 * `furniture` and `npcs` are deliberately uncached. Route new writes through
 * `adjustRelation` instead.
 *
 * ── DECAY ────────────────────────────────────────────────────────────────────
 *
 * There is deliberately NO decay tick. Decay is computed lazily from
 * `last_seen_at` when the row is hydrated, so an offline player costs nothing
 * and a returning one finds a cast that has correctly cooled toward neutral.
 * It also reads better in fiction: you *discover* that you've been forgotten at
 * the moment you walk back in, which is when it should sting.
 *
 * Constants live here as module tables rather than in tunables.js — that store
 * is `combat_config`-backed, and smuggling social knobs into the combat config
 * would put them somewhere nobody would look for them.
 */
import { query } from '../models/db.js';
import { registerAction } from './actions.js';
import { registerConditionShape } from './flags.js';
import { emit, on } from './events.js';
import { getLivePlayer, world } from './world.js';
import { warmthMultiplier } from './hygiene.js';
import { mutationNumber } from './mutations.js';

// ── Scale ────────────────────────────────────────────────────────────────────
//
// FAMILIARITY (0..100) — how well they know you. Only ever grows through
// contact, and decays slowly: people forget acquaintances far more slowly than
// they cool on them.
//
// WARMTH (-100..100) — how they feel about you. Signed, because an NPC who
// actively dislikes you is a different thing from one who's never met you, and
// the tier ladder has to be able to tell those apart.
const FAMILIARITY_MAX = 100;
const WARMTH_MAX = 100;
const WARMTH_MIN = -100;

// Half-lives, in real days. Warmth fades in about three weeks of being ignored;
// familiarity takes a season. Neither ever reaches zero — they asymptote, so a
// long-lost regular is still a notch above a total stranger, which is right.
const WARMTH_HALFLIFE_DAYS = 21;
const FAMILIARITY_HALFLIFE_DAYS = 90;
const DAY_MS = 86_400_000;

// Ordinary contact is worth very little on its own — a relationship is built by
// showing up repeatedly, not by one long conversation. The per-NPC cooldown
// below is what stops a player farming warmth by spamming `talk`.
const CONTACT_FAMILIARITY = 1.5;
const CONTACT_WARMTH = 0.5;
const CONTACT_COOLDOWN_MS = 10 * 60 * 1000;

// Money is not friendship, but it is *acquaintance* — a regular customer is
// someone you know. Scaled off spend, hard-capped so one luxury purchase can't
// buy a relationship outright.
const PURCHASE_FAMILIARITY = 1;
const PURCHASE_WARMTH_PER_100C = 0.5;
const PURCHASE_WARMTH_CAP = 3;

// ── Tiers ────────────────────────────────────────────────────────────────────
//
// The ONE question everything else asks. Deliberately bands, not a curve (the
// same reasoning as condition.js): a player has to be able to feel "she knows
// me now" as a discrete change, not a drift they can't read.
//
// Order matters — hostility outranks familiarity. Someone who knows you well
// and hates you is not "close", they're an enemy who knows where you live.
export const RELATION_TIERS = ['hostile', 'wary', 'stranger', 'known', 'familiar', 'close'];

const ZERO = Object.freeze({ familiarity: 0, warmth: 0, met_at: 0, last_seen_at: 0 });

// Sync by contract. Callers on arrival/banter/describe paths depend on this
// never awaiting — see the read-tier note at the top of this file.
export function getRelation(player, npcId) {
  if (!player || !npcId) return ZERO;
  return player._relations?.get(npcId) || ZERO;
}

export function relationTier(rel) {
  const warmth = Number(rel?.warmth) || 0;
  const familiarity = Number(rel?.familiarity) || 0;
  if (warmth <= -60) return 'hostile';
  if (warmth <= -20) return 'wary';
  if (familiarity >= 20 && warmth >= 70) return 'close';
  if (familiarity >= 8 && warmth >= 30) return 'familiar';
  if (familiarity >= 3) return 'known';
  return 'stranger';
}

// Convenience for the common gate: "do they know me at least this well?"
// Compares by ladder position, so `atLeast(rel, 'known')` is false for a hostile
// NPC no matter how many times you've met — which is the intended reading.
export function relationAtLeast(rel, tier) {
  const have = RELATION_TIERS.indexOf(relationTier(rel));
  const want = RELATION_TIERS.indexOf(tier);
  return want < 0 ? true : have >= want;
}

// ── What knowing you is WORTH ────────────────────────────────────────────────
//
// The substrate's one concession to gameplay: a single scalar that systems can
// read to decide how much better (or worse) they treat you. Kept here rather
// than duplicated per system so a regular gets a consistent deal everywhere —
// and so retuning generosity is one table, not a hunt.
//
// Negative tiers charge you MORE. Being disliked has to cost something, or
// warmth is a one-way ratchet with no downside to ignore.
const HELP_BY_TIER = {
  hostile: -0.15,
  wary: -0.05,
  stranger: 0,
  known: 0.03,
  familiar: 0.08,
  close: 0.15,
};

// Sync, zero queries — safe to call from a price calculation or a describe path.
export function relationHelp(player, npcId) {
  return HELP_BY_TIER[relationTier(getRelation(player, npcId))] || 0;
}

// ── Decay ────────────────────────────────────────────────────────────────────

function decayed(row, now) {
  const last = Number(row.last_seen_at) * 1000 || now;
  const days = Math.max(0, (now - last) / DAY_MS);
  if (days < 1) return { warmth: Number(row.warmth) || 0, familiarity: Number(row.familiarity) || 0 };
  return {
    warmth: (Number(row.warmth) || 0) * Math.pow(0.5, days / WARMTH_HALFLIFE_DAYS),
    familiarity: (Number(row.familiarity) || 0) * Math.pow(0.5, days / FAMILIARITY_HALFLIFE_DAYS),
  };
}

// ── Hydrate / flush ──────────────────────────────────────────────────────────

// ONE query, at login. Called from finishAuth alongside the other reads that
// exist precisely so runtime never has to make them (combat_stance, sense
// attunement). Mutates the live player in place — never clone-and-replace; the
// game loop holds direct references (see posture.js).
export async function hydrateRelations(player) {
  player._relations = new Map();
  player._relationsDirty = new Set();
  if (!player?.id) return;
  let rows = [];
  try {
    ({ rows } = await query(
      'SELECT npc_id, familiarity, warmth, met_at, last_seen_at FROM player_npc_relations WHERE player_id = $1',
      [player.id]
    ));
  } catch (err) {
    // A relationship the game can't load is a game that runs with everyone as a
    // stranger — degraded, never broken. Never block a login on this.
    console.error(`[relations] hydrate failed for ${player.id}: ${err.message}`);
    return;
  }
  const now = Date.now();
  for (const row of rows) {
    const { warmth, familiarity } = decayed(row, now);
    player._relations.set(row.npc_id, {
      familiarity, warmth,
      met_at: Number(row.met_at) || 0,
      last_seen_at: Number(row.last_seen_at) || 0,
    });
    // The decayed value is only in memory until something else touches this
    // relationship. That's deliberate: decay is a pure function of elapsed time,
    // so recomputing it next login gives the same answer. Writing every row back
    // at every login would be a write storm for no information gained.
  }
}

// Coalesced multi-row upsert, mirroring flushDirtyResources in combat.js.
// Called on a cadence from the game loop and once more at logout.
export async function flushRelations(player) {
  const dirty = player?._relationsDirty;
  if (!dirty?.size) return;
  const ids = [...dirty];
  const rows = [];
  const params = [];
  ids.forEach((npcId, i) => {
    const rel = player._relations.get(npcId);
    if (!rel) return;
    const b = params.length;
    rows.push(`($${b + 1}::text, $${b + 2}::text, $${b + 3}::real, $${b + 4}::real, $${b + 5}::bigint, $${b + 6}::bigint)`);
    params.push(player.id, npcId, rel.familiarity, rel.warmth, rel.met_at, rel.last_seen_at);
  });
  if (!rows.length) { dirty.clear(); return; }
  try {
    await query(
      `INSERT INTO player_npc_relations (player_id, npc_id, familiarity, warmth, met_at, last_seen_at)
       VALUES ${rows.join(', ')}
       ON CONFLICT (player_id, npc_id) DO UPDATE
         SET familiarity = EXCLUDED.familiarity,
             warmth = EXCLUDED.warmth,
             last_seen_at = EXCLUDED.last_seen_at`,
      params
    );
    dirty.clear();
  } catch (err) {
    // Leave the set dirty — the next flush retries. A lost relationship write is
    // a forgotten conversation, which is survivable; a thrown error inside a
    // scheduled tick is not.
    console.error(`[relations] flush failed for ${player.id}: ${err.message}`);
  }
}

export async function flushAllRelations() {
  const dirty = [];
  for (const p of world.players.values()) if (p._relationsDirty?.size) dirty.push(p);
  // Independent single-player writes — issue them together rather than serially
  // chaining a round trip each.
  await Promise.all(dirty.map((p) => flushRelations(p)));
}

// ── Mutation (the ONLY write path) ───────────────────────────────────────────

/**
 * Move a relationship. Synchronous — it writes memory and marks dirty; the
 * durable write happens on the next flush.
 *
 * `reason` is a short source label ('dialogue:contact', 'vendor:purchase',
 * authored `RELATION_ADJUST` nodes pass their own) carried on the event, the
 * same convention adjustCredits uses.
 */
export function adjustRelation(player, npcId, { familiarity = 0, warmth = 0, reason = null } = {}) {
  if (!player?.id || !npcId) return ZERO;
  // Guard the two independently. They're always created together by
  // hydrateRelations, but a player object assembled any other way (a test
  // double, a future code path) can carry one without the other — and a missing
  // dirty set would throw here rather than degrade.
  if (!player._relations) player._relations = new Map();
  if (!player._relationsDirty) player._relationsDirty = new Set();

  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  let rel = player._relations.get(npcId);
  const isFirstMeeting = !rel;
  if (!rel) {
    rel = { familiarity: 0, warmth: 0, met_at: nowSec, last_seen_at: nowSec };
    player._relations.set(npcId, rel);
  }

  // Warming to somebody is harder when they smell. Familiarity is untouched —
  // being memorable and being liked are different things, and turning up filthy
  // is certainly memorable. Only GAINS are damped: this can never make an NPC
  // like you less, it just slows how fast they come round.
  //
  // One central seam on purpose. Every system that moves warmth (talk, gifts,
  // quests, MIS, a finished shift) inherits it without knowing hygiene exists.
  // …and being visibly clean is the other end of the same dial: it makes people
  // warm to you FASTER. Both ends live in one function in hygiene.js so the
  // penalty and the reward can never drift apart.
  // …and a body people can't stop looking at is the third end of the same dial.
  // Same contract as hygiene: GAINS only, so a mutation slows how fast someone
  // warms to you and can never drive them backwards. Applied here rather than
  // folded into warmthMultiplier because hygiene.js must not have to know that
  // mutations exist.
  if (warmth > 0) warmth *= warmthMultiplier(player) * (1 - mutationNumber(player, 'social_penalty'));

  const beforeTier = relationTier(rel);
  rel.familiarity = Math.min(FAMILIARITY_MAX, Math.max(0, rel.familiarity + familiarity));
  rel.warmth = Math.min(WARMTH_MAX, Math.max(WARMTH_MIN, rel.warmth + warmth));
  rel.last_seen_at = nowSec;
  player._relationsDirty.add(npcId);

  const afterTier = relationTier(rel);
  if (isFirstMeeting) emit('relation.met', { actor: player, npcId, reason });
  if (afterTier !== beforeTier) {
    // Push-driven reactions (an NPC noticing you've become a regular) hang off
    // this rather than polling the number, the posture.changed model.
    emit('relation.tierChanged', { actor: player, npcId, from: beforeTier, to: afterTier, reason });
  }
  return rel;
}

/**
 * You bought something from them. Familiarity moves a little on every sale —
 * that's the face turning up again — and warmth scales off what you spent, on
 * the reasoning that a vendor warms to a good customer faster than a browsing
 * one. Capped per purchase so a single luxury item can't buy a relationship.
 *
 * Sync, like everything else here, so the sale path adds no round trip.
 */
export function recordPurchase(player, npcId, price = 0) {
  if (!player?.id || !npcId) return ZERO;
  const warmth = Math.min(
    PURCHASE_WARMTH_CAP,
    (Math.max(0, Number(price) || 0) / 100) * PURCHASE_WARMTH_PER_100C
  );
  return adjustRelation(player, npcId, {
    familiarity: PURCHASE_FAMILIARITY,
    warmth,
    reason: 'vendor:purchase',
  });
}

/**
 * Ordinary contact — you spoke to them. Rate-limited per (player, NPC) so
 * relationships are built by showing up over time, not by spamming `talk`.
 * Returns true if the contact actually counted.
 *
 * In-memory cooldown (resets on restart), like gossip's tell cooldown: a window
 * this short doesn't warrant persistence, and the failure mode of losing it is
 * one extra point of familiarity.
 */
const contactCooldowns = new Map(); // `${playerId}:${npcId}` -> expiry ts
export function touchRelation(player, npcId, opts = {}) {
  if (!player?.id || !npcId) return false;
  const key = `${player.id}:${npcId}`;
  const now = Date.now();
  if (now < (contactCooldowns.get(key) || 0)) return false;
  contactCooldowns.set(key, now + CONTACT_COOLDOWN_MS);
  adjustRelation(player, npcId, {
    familiarity: opts.familiarity ?? CONTACT_FAMILIARITY,
    warmth: opts.warmth ?? CONTACT_WARMTH,
    reason: opts.reason || 'contact',
  });
  return true;
}

// ── Authored gates (VINE) ────────────────────────────────────────────────────
//
// `{ relation: 'known' }` on any dialogue option, script branch or quest gate.
// `npc` is optional and defaults to whoever is speaking, which is the normal
// authored case. Registered into flags.js rather than built in there, so the
// substrate owns its own shape and flags.js keeps no import on us.
//
// Costs ZERO round trips — the whole reason this is worth having as a condition
// at all, and why it's safe in places the item/stat shapes are not.
registerConditionShape('relation', (condition, player, context) => {
  const npcId = condition.npc || context?.npc?.id;
  if (!player || !npcId) return false;
  const rel = getRelation(player, npcId);
  const want = String(condition.relation);
  if (!RELATION_TIERS.includes(want)) {
    // Fails closed rather than silently passing — a typo'd tier hides the
    // option instead of showing it to everyone.
    console.warn(`[relations] unknown relation tier in condition: ${want}`);
    return false;
  }
  switch (condition.op || 'atLeast') {
    case 'is':    return relationTier(rel) === want;
    case 'isNot': return relationTier(rel) !== want;
    case 'below': return !relationAtLeast(rel, want);
    default:      return relationAtLeast(rel, want);
  }
});

// ── Authored moves (VINE) ────────────────────────────────────────────────────
//
// The whole point of the substrate: an author can move a relationship from a
// dialogue node or script graph without touching code. Flat params, because the
// VINE dialogue editor authors actions flat ({action, warmth, …}) — see the
// `a.params || a` fallback in dialogue.js.
registerAction({
  type: 'RELATION_ADJUST',
  handler: ({ actor, params = {}, context }) => {
    const npcId = params.npc_id || context?.npc?.id;
    if (!npcId) return { type: 'error', message: 'RELATION_ADJUST: no npc' };
    const rel = adjustRelation(actor, npcId, {
      familiarity: Number(params.familiarity) || 0,
      warmth: Number(params.warmth) || 0,
      reason: params.reason || 'authored',
    });
    // Deliberately returns no dialogue_line: the player should never be told a
    // number moved. They find out from how the NPC talks to them next time.
    return { type: 'relation', tier: relationTier(rel) };
  },
});

// ── Automatic accrual ────────────────────────────────────────────────────────
//
// Consumes events that already exist rather than adding call sites. A regular
// customer becomes a familiar face without anyone authoring anything.
on('vendor.purchase', ({ player, npcId, price }) => {
  if (!npcId) return;
  const live = getLivePlayer(player?.id);
  if (!live) return;
  adjustRelation(live, npcId, {
    familiarity: PURCHASE_FAMILIARITY,
    warmth: Math.min(PURCHASE_WARMTH_CAP, ((Number(price) || 0) / 100) * PURCHASE_WARMTH_PER_100C),
    reason: 'vendor:purchase',
  });
});
