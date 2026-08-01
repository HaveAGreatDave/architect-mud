// Recipe knowledge — which dishes a player has in their cookbook, and the three
// ways one gets there.
//
// Knowing a recipe NEVER gates cooking it. Any combination always cooks; the
// cookbook is a record and a small edge, not a permission system. That's what
// keeps discovery-by-experiment alive: a player who has never heard of a chowder
// can still make one by putting the right things in a pot, and the act of doing
// so is exactly what writes it down.
//
// Storage is one player_flag per known dish — `cookbook:<key>` holding the best
// band that player has ever achieved on it. No new players column, no new table
// (docs/architecture.md). 22 dishes is the ceiling on rows per player.
import { registerAction } from '../../server/engine/actions.js';
import {
  getFlagsMulti, getFlagById, setFlagById, updateFlagById,
  insertFlagIfAbsentById, clearFlagsIn, getFlagsByPrefix,
} from '../../server/engine/flags.js';
import { DISHES } from './dishes.js';
import { QUALITY_BANDS, bandIndex } from './profiles.js';
import { KNOWN_RECIPE_BONUS, DISCOVERY_ATTEMPTS, DISCOVERY_MIN_BAND } from './config.js';

export const FLAG_PREFIX = 'cookbook:';

// Dishes you've turned out well but not yet often enough to have written down.
// Cleared the moment the recipe is learned, so it never outlives its purpose.
export const PROGRESS_PREFIX = 'cookprog:';

// A recipe you hold on paper but have never actually cooked.
export const UNTRIED = 'untried';

// The cookbook and the in-progress tally, in ONE round trip. Both live in
// player_flags under their own prefixes, so a single LIKE-pair fetches the lot.
// When this player last earned routine cooking IP. Same table, so it rides
// along on the read the plate path already does — no extra round trip.
export const IP_FLAG = 'cook_ip_at';

export async function cookbookState(playerId) {
  // Two prefixes + one exact key, still in ONE round trip — and none at all for a
  // player whose flags are hydrated. Goes through the flag store so the cookbook
  // can never read stale (see the write-funnel contract in engine/flags.js).
  const found = await getFlagsMulti(playerId, {
    prefixes: [FLAG_PREFIX, PROGRESS_PREFIX],
    keys: [IP_FLAG],
  });
  const known = new Map(), progress = new Map();
  let lastIpAt = 0;
  for (const [flagKey, flagValue] of found) {
    if (flagKey === IP_FLAG) { lastIpAt = Number(flagValue) || 0; continue; }
    if (flagKey.startsWith(FLAG_PREFIX)) {
      const key = flagKey.slice(FLAG_PREFIX.length);
      if (DISHES[key]) known.set(key, flagValue);
    } else {
      const key = flagKey.slice(PROGRESS_PREFIX.length);
      if (DISHES[key]) progress.set(key, Number(flagValue) || 0);
    }
  }
  return { known, progress, lastIpAt };
}

export async function markRoutineIp(playerId, at = Date.now()) {
  await setFlagById(playerId, IP_FLAG, String(at));
}

// Everything this player knows: key -> best band.
export async function knownRecipes(playerId) {
  return (await cookbookState(playerId)).known;
}

// Log one plating of an as-yet-unknown dish. Returns what the caller should say:
// `counted` false means the cook wasn't good enough to learn anything from.
export async function recordAttempt(playerId, key, band, soFar = 0) {
  if (!DISHES[key]) return { learned: false, counted: false, count: soFar };
  if (bandIndex(band) < bandIndex(DISCOVERY_MIN_BAND)) {
    return { learned: false, counted: false, count: soFar };
  }

  const count = soFar + 1;
  if (count >= DISCOVERY_ATTEMPTS) {
    await learnRecipe(playerId, key, band);   // also clears the tally
    return { learned: true, counted: true, count };
  }

  await setFlagById(playerId, PROGRESS_PREFIX + key, String(count));
  return { learned: false, counted: true, count };
}

export async function knowsRecipe(playerId, key) {
  return (await getFlagById(playerId, FLAG_PREFIX + key)) !== undefined;
}

// Write a dish into the cookbook, keeping the best band ever achieved. Returns
// { learned, improved, band } so the caller can narrate the *new* thing only —
// making the same stew twice shouldn't announce itself twice.
//
// `band` may be null for a recipe learned on paper or from an NPC: you know it,
// you've never cooked it. Those sort to the bottom of the app as "untried".
export async function learnRecipe(playerId, key, band = null) {
  if (!DISHES[key]) return { learned: false, band: null };
  const value = band && QUALITY_BANDS.includes(band) ? band : UNTRIED;

  const [learned] = await Promise.all([
    insertFlagIfAbsentById(playerId, FLAG_PREFIX + key, value),
    // However you came by it — repetition, a card, an NPC — the half-finished
    // tally has done its job and shouldn't linger.
    clearFlagsIn(playerId, [PROGRESS_PREFIX + key]),
  ]);
  return { learned, band: value };
}

// Raise the recorded band on a recipe already in the book. The caller decides
// whether this is an improvement — it already holds the map it loaded, so this
// costs a write and never a read.
export async function improveRecipe(playerId, key, band) {
  // UPDATE-only by design: raising the band on a recipe already in the book must
  // never mint a row for one that isn't.
  await updateFlagById(playerId, FLAG_PREFIX + key, band);
}

// Is `band` better than what's on record for this recipe? `untried` loses to
// every real band, which is what promotes a paper recipe the first time it's
// actually cooked.
export function beatsRecorded(recorded, band) {
  if (!recorded || recorded === UNTRIED) return true;
  return bandIndex(band) > bandIndex(recorded);
}

// The whole mechanical value of knowing a recipe: a sub-band nudge that tips
// rounding your way. Deliberately small — it must never be worth more than
// actually cooking well, or the cookbook becomes the game.
export function knownBonus(known, key) {
  return known?.has(key) ? KNOWN_RECIPE_BONUS : 0;
}

// ── Collection path 3: taught by an NPC ──────────────────────────────────────
// A dialogue node fires TEACH_RECIPE with { recipe }. Same shape as the other
// content-facing Actions (ADJUST_REPUTATION and friends) so a VINE graph can
// reach it without any cooking-specific plumbing.
registerAction({
  type: 'TEACH_RECIPE',
  handler: async ({ actor, params }) => {
    const key = String(params?.recipe || '').trim();
    const dish = DISHES[key];
    if (!actor?.id || !dish) return { type: 'error', message: 'No such recipe.' };
    const { learned } = await learnRecipe(actor.id, key);
    return {
      type: 'output',
      message: learned
        ? `You listen, and you get it. ${dish.noun[0].toUpperCase()}${dish.noun.slice(1)} — added to your cookbook.`
        : `You already know how to make that.`,
    };
  },
});

// ---------------------------------------------------------------------------
// PLAYER RECIPES — the half of the cookbook you write yourself
// ---------------------------------------------------------------------------
//
// The authored catalog is a fixed 47 dishes and it belongs to the game. This is
// the other book: what a player worked out on their own, named themselves, and
// can hand to somebody else. Improvised dishes (improvised.js) are the raw
// material — you cook something, it turns out well, and you write it down.
//
// Storage is the same shape the cookbook already uses: one `player_flags` row
// per saved recipe, `recipe:<slug>` holding a small JSON blob. No new table and
// no new `players` column, per the core rule in CLAUDE.md.
//
// A saved recipe is IDENTIFIED by its signature — the multiset of profiles that
// made it, rounded to whole units, plus the vessel (see `recipeSignature`). The
// NAME is just a label, which is exactly why renaming is free and why two
// players can call the same combination different things.
export const SAVED_PREFIX = 'recipe:';

export const slugify = name => String(name || '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// Every recipe this player has written down. Zero round trips for a hydrated
// player, same as `cookbookState`.
export async function savedRecipes(playerOrId) {
  const found = await getFlagsByPrefix(playerOrId, SAVED_PREFIX);
  const out = new Map();
  for (const [k, v] of found) {
    let blob = null;
    try { blob = JSON.parse(v); } catch { continue; }
    if (blob && blob.sig) out.set(k.slice(SAVED_PREFIX.length), blob);
  }
  return out;
}

// The one this pan would be, if you've written it down. Signature match, never
// name match — you might have called it anything.
export function recipeBySignature(saved, sig) {
  for (const [slug, blob] of saved) if (blob.sig === sig) return { slug, ...blob };
  return null;
}

// Write one down. Refuses a duplicate SIGNATURE rather than a duplicate name:
// the same pot under a second name would be two recipes that can never be told
// apart, and the second would silently never match.
export async function saveRecipe(playerOrId, { name, sig, vessel, family, complexity, band, author }) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  const saved = await savedRecipes(playerId);
  const already = recipeBySignature(saved, sig);
  if (already) return { saved: false, reason: 'known', existing: already };

  let slug = slugify(name) || `dish-${saved.size + 1}`;
  if (saved.has(slug)) slug = `${slug}-${saved.size + 1}`;
  await setFlagById(playerId, SAVED_PREFIX + slug, JSON.stringify({
    name: String(name).slice(0, 60), sig, vessel: vessel || null,
    family: family || null, complexity: complexity || 1,
    best: band || null, author: author || null,
  }));
  return { saved: true, slug };
}

// Renaming is free and changes nothing mechanical — the signature is the
// identity, the name is a label. That asymmetry is the whole reason a player can
// call their stew whatever they like without breaking the match.
export async function renameRecipe(playerOrId, slug, name) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  const raw = await getFlagById(playerId, SAVED_PREFIX + slug);
  if (!raw) return { ok: false };
  let blob; try { blob = JSON.parse(raw); } catch { return { ok: false }; }
  blob.name = String(name).slice(0, 60);
  await setFlagById(playerId, SAVED_PREFIX + slug, JSON.stringify(blob));
  return { ok: true, name: blob.name };
}

export async function forgetRecipe(playerOrId, slug) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  await clearFlagsIn(playerId, [SAVED_PREFIX + slug]);
  return { ok: true };
}

// Improve the recorded best band, the same UPDATE-only way `improveRecipe` does
// for the authored catalog.
export async function improveSaved(playerOrId, slug, blob, band) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  await setFlagById(playerId, SAVED_PREFIX + slug, JSON.stringify({ ...blob, best: band }));
}
